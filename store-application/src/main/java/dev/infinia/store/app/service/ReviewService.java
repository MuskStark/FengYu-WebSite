package dev.infinia.store.app.service;

import tools.jackson.databind.ObjectMapper;
import dev.infinia.store.contract.api.PublisherDtos;
import dev.infinia.store.contract.api.ReviewDtos.ReviewDecisionRequest;
import dev.infinia.store.contract.error.StoreErrorCode;
import dev.infinia.store.contract.event.StoreEventPayloads;
import dev.infinia.store.contract.type.ReviewDecisionType;
import dev.infinia.store.contract.type.ReleaseStatus;
import dev.infinia.store.domain.DomainException;
import dev.infinia.store.domain.model.Listing;
import dev.infinia.store.domain.model.OutboxRecord;
import dev.infinia.store.domain.model.Release;
import dev.infinia.store.domain.model.Review;
import dev.infinia.store.domain.port.ListingRepository;
import dev.infinia.store.domain.port.PublishingRepositories;
import dev.infinia.store.domain.port.ReleaseRepository;
import dev.infinia.store.domain.port.BlobStorage;
import dev.infinia.store.domain.service.ReleaseStateMachine;
import dev.infinia.store.domain.service.UuidV7;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Human review decisions and security withdrawals (design §8.1, §7.3). Approval
 * platform-signs the release envelope, publishes the release and emits the outbox
 * event consumed by webhooks and the search indexer.
 */
@Service
public class ReviewService {

    private final PublishingRepositories.ReviewRepository reviews;
    private final ReleaseRepository releases;
    private final ListingRepository listings;
    private final PublishingRepositories.OutboxRepository outbox;
    private final PlatformSigningService signing;
    private final CatalogService catalog;
    private final AuditService audit;
    private final ObjectMapper mapper;
    private final BlobStorage blobs;

    public ReviewService(PublishingRepositories.ReviewRepository reviews,
            ReleaseRepository releases, ListingRepository listings,
            PublishingRepositories.OutboxRepository outbox, PlatformSigningService signing,
            CatalogService catalog, AuditService audit, ObjectMapper mapper, BlobStorage blobs) {
        this.reviews = reviews;
        this.releases = releases;
        this.listings = listings;
        this.outbox = outbox;
        this.signing = signing;
        this.catalog = catalog;
        this.audit = audit;
        this.mapper = mapper;
        this.blobs = blobs;
    }

    public List<Review> queue(String status) {
        return reviews.findByStatus(status == null ? "IN_REVIEW" : status, 100);
    }

    public Review decide(UUID reviewerUserId, UUID reviewId, ReviewDecisionRequest request) {
        return decide(reviewerUserId, reviewId, request, false);
    }

    /**
     * Records a review decision. The self-review guard (design §7.3: a reviewer must
     * never approve their own release) binds ordinary reviewers; PLATFORM_ADMIN is
     * the platform's trust root — the same actor the admin force-publish and
     * admin-upload paths already trust — and may decide their own releases, with
     * the decision still audited under their own id.
     */
    @Transactional
    public Review decide(UUID reviewerUserId, UUID reviewId, ReviewDecisionRequest request,
            boolean platformAdminOverride) {
        Review review = reviews.findById(reviewId)
                .orElseThrow(() -> new DomainException(StoreErrorCode.NOT_FOUND,
                        "Review not found"));
        Release release = releases.findById(review.releaseId)
                .orElseThrow(() -> new DomainException(StoreErrorCode.RELEASE_NOT_FOUND,
                        "Release not found"));
        Listing listing = listings.findById(release.listingId)
                .orElseThrow(() -> new DomainException(StoreErrorCode.LISTING_NOT_FOUND,
                        "Listing not found"));
        // An unattributable caller (client-credentials token with no service
        // account) must not slip past the guard on a null id.
        if (reviewerUserId == null) {
            throw DomainException.forbidden("Review decisions require an attributed reviewer");
        }
        if (!platformAdminOverride && reviewerUserId.equals(listing.publisherUserId)) {
            throw new DomainException(StoreErrorCode.SELF_REVIEW_FORBIDDEN,
                    "Reviewers cannot review their own releases");
        }
        ReviewDecisionType decision;
        try {
            decision = ReviewDecisionType.valueOf(request.decision().toUpperCase());
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new DomainException(StoreErrorCode.VALIDATION_FAILED,
                    "decision must be APPROVE, REJECT or REQUEST_CHANGES");
        }
        switch (decision) {
            case APPROVE -> approve(reviewerUserId, review, release, listing, request.notes());
            case REJECT -> {
                ReleaseStateMachine.assertTransition(release.status, ReleaseStatus.REJECTED);
                release.status = ReleaseStatus.REJECTED;
                review.status = "REJECTED";
                enqueue(StoreEventPayloads.RELEASE_REJECTED, release.id, toJson(
                        new StoreEventPayloads.ReleaseRejected(
                                listing.coordinate().withVersion(release.version).toString(),
                                release.id.toString(), "review.rejected", List.of())));
            }
            case REQUEST_CHANGES -> {
                ReleaseStateMachine.assertTransition(release.status,
                        ReleaseStatus.CHANGES_REQUESTED);
                release.status = ReleaseStatus.CHANGES_REQUESTED;
                review.status = "CHANGES_REQUESTED";
            }
        }
        review.reviewerId = reviewerUserId;
        review.notes = request.notes();
        review.decidedAt = Instant.now();
        reviews.save(review);
        releases.save(release);
        audit.record(reviewerUserId == null ? "SERVICE" : "USER",
                reviewerUserId == null ? "store-cli" : reviewerUserId.toString(),
                "review." + decision.name().toLowerCase(), "REVIEW", review.id.toString(),
                null, release.status.name(), null);
        return review;
    }

    private void approve(UUID reviewerUserId, Review review, Release release, Listing listing,
            String notes) {
        ReleaseStateMachine.assertTransition(release.status, ReleaseStatus.APPROVED);
        release.status = ReleaseStatus.APPROVED;
        ReleaseStateMachine.assertTransition(release.status, ReleaseStatus.PUBLISHED);
        release.status = ReleaseStatus.PUBLISHED;
        release.publishedAt = Instant.now();

        // Platform signature over the canonical envelope (design §8.3).
        String envelopeJson = catalog.canonicalJson(catalog.buildEnvelope(listing, release));
        String signature = signing.sign(envelopeJson);
        String keyId = signing.currentKeyId();
        release.artifacts = new ArrayList<>(release.artifacts);
        for (int i = 0; i < release.artifacts.size(); i++) {
            Release.ArtifactInfo a = release.artifacts.get(i);
            release.artifacts.set(i, new Release.ArtifactInfo(a.id(), a.kind(), a.platform(),
                    a.arch(), a.variant(), a.filename(), a.size(), a.sha256(),
                    a.signature() == null ? signArtifact(a, signature) : a.signature(),
                    a.keyId() == null ? keyId : a.keyId(), a.blobKey(), a.mimeType()));
        }
        review.status = "APPROVED";
        listing.updatedAt = Instant.now();
        listings.save(listing);
        enqueue(StoreEventPayloads.RELEASE_PUBLISHED, release.id, toJson(
                new StoreEventPayloads.ReleasePublished(
                        listing.coordinate().withVersion(release.version).toString(),
                        release.id.toString(), release.version.toString(),
                        release.channel.name().toLowerCase(), release.publishedAt.toString(),
                        envelopeJson)));
    }

    /**
     * Admin override for scan false-positives (design §15.3: exceptions require a
     * human decision): publishes a REJECTED release after manual review. Audited
     * distinctly from a normal approval so the exception trail stays visible.
     */
    @Transactional
    public Release forcePublish(UUID adminUserId, UUID releaseId, String reason) {
        Release release = releases.findById(releaseId).orElseThrow(
                () -> new DomainException(StoreErrorCode.RELEASE_NOT_FOUND,
                        "Release not found"));
        if (release.status == ReleaseStatus.PUBLISHED) {
            return release; // idempotent
        }
        if (release.status != ReleaseStatus.REJECTED) {
            throw new DomainException(StoreErrorCode.INVALID_STATE_TRANSITION,
                    "Only REJECTED releases can be force-published (current: "
                            + release.status + ")");
        }
        Listing listing = listings.findById(release.listingId)
                .orElseThrow(() -> new DomainException(StoreErrorCode.LISTING_NOT_FOUND,
                        "Listing not found"));
        reviews.findLatestByReleaseId(release.id).ifPresent(review -> {
            review.status = "APPROVED";
            review.notes = "Force-published by platform admin: " + reason;
            review.reviewerId = adminUserId;
            review.decidedAt = Instant.now();
            reviews.save(review);
        });
        release.status = ReleaseStatus.PUBLISHED;
        release.publishedAt = Instant.now();
        releases.save(release);
        signArtifactsAndEmitPublished(listing, release);
        audit.record("USER", adminUserId.toString(), "release.force-publish", "RELEASE",
                release.id.toString(), "REJECTED", "PUBLISHED: " + reason, null);
        return release;
    }

    /**
     * Admin manual upload for intranet deployments (the store replaces the FY-Proxy
     * distribution center): publishes a freshly uploaded release directly — the
     * platform admin IS the review decision — signing the envelope and every
     * artifact exactly like an approval. Audited distinctly so the exception
     * trail stays visible.
     */
    @Transactional
    public Release publishAdminUpload(UUID adminUserId, Release release) {
        if (release.status == ReleaseStatus.PUBLISHED) {
            return release; // idempotent
        }
        if (release.status != ReleaseStatus.DRAFT && release.status != ReleaseStatus.UPLOADING) {
            throw new DomainException(StoreErrorCode.INVALID_STATE_TRANSITION,
                    "Only freshly uploaded releases can be admin-published (current: "
                            + release.status + ")");
        }
        Listing listing = listings.findById(release.listingId)
                .orElseThrow(() -> new DomainException(StoreErrorCode.LISTING_NOT_FOUND,
                        "Listing not found"));
        // What counts as the installable payload depends on the listing type: APP
        // releases ship INSTALLER/PORTABLE distributions, everything a store can
        // install into the host (plugins, skills, MCP, flows) ships as a PACKAGE.
        boolean installable;
        if (listing.type == dev.infinia.store.contract.type.ListingType.APP) {
            installable = release.artifacts.stream().anyMatch(a ->
                    a.kind() == dev.infinia.store.contract.type.ArtifactKind.INSTALLER
                            || a.kind() == dev.infinia.store.contract.type.ArtifactKind.PORTABLE);
        } else {
            installable = release.artifacts.stream().anyMatch(a ->
                    a.kind() == dev.infinia.store.contract.type.ArtifactKind.PACKAGE);
        }
        if (!installable) {
            throw new DomainException(StoreErrorCode.VALIDATION_FAILED,
                    listing.type + " release needs at least one "
                            + (listing.type == dev.infinia.store.contract.type.ListingType.APP
                                    ? "INSTALLER or PORTABLE" : "PACKAGE")
                            + " artifact");
        }
        release.status = ReleaseStatus.PUBLISHED;
        release.publishedAt = Instant.now();
        releases.save(release);
        signArtifactsAndEmitPublished(listing, release);
        audit.record("USER", adminUserId.toString(), "release.admin-publish", "RELEASE",
                release.id.toString(), release.status.name(), "intranet manual upload", null);
        return release;
    }

    /** Platform-signs the envelope + unsigned artifacts, then emits RELEASE_PUBLISHED. */
    private void signArtifactsAndEmitPublished(Listing listing, Release release) {
        String envelopeJson = catalog.canonicalJson(catalog.buildEnvelope(listing, release));
        release.artifacts = new ArrayList<>(release.artifacts);
        for (int i = 0; i < release.artifacts.size(); i++) {
            Release.ArtifactInfo a = release.artifacts.get(i);
            if (a.signature() == null) {
                release.artifacts.set(i, new Release.ArtifactInfo(a.id(), a.kind(),
                        a.platform(), a.arch(), a.variant(), a.filename(), a.size(), a.sha256(),
                        signArtifact(a, signing.sign(envelopeJson)), signing.currentKeyId(), a.blobKey(),
                        a.mimeType()));
            }
        }
        releases.save(release);
        enqueue(StoreEventPayloads.RELEASE_PUBLISHED, release.id, toJson(
                new StoreEventPayloads.ReleasePublished(
                        listing.coordinate().withVersion(release.version).toString(),
                        release.id.toString(), release.version.toString(),
                        release.channel.name().toLowerCase(), release.publishedAt.toString(),
                        envelopeJson)));
    }

    private String signArtifact(Release.ArtifactInfo artifact, String envelopeFallback) {
        if (blobs == null || artifact.blobKey() == null
                || artifact.blobKey().startsWith("upstream/")) {
            return envelopeFallback;
        }
        return signing.sign(blobs.open(artifact.blobKey()));
    }

    /**
     * Publisher-side deletion of an unpublished release (draft, rejected, changes
     * requested, in review) so abandoned flows can be cleared from the publishing
     * board. Owner-only; published and withdrawn releases are out of scope —
     * withdrawing is an admin action (design §8.1). Mirrors the admin
     * {@link #deleteRelease} semantics: hard row removal, RELEASE_DELETED outbox
     * event, audited.
     */
    @Transactional
    public void deleteUnpublished(UUID userId, UUID releaseId) {
        Release release = releases.findById(releaseId).orElseThrow(
                () -> new DomainException(StoreErrorCode.RELEASE_NOT_FOUND,
                        "Release not found"));
        Listing listing = listings.findById(release.listingId)
                .orElseThrow(() -> new DomainException(StoreErrorCode.LISTING_NOT_FOUND,
                        "Listing not found"));
        if (!listing.publisherUserId.equals(userId)) {
            throw DomainException.forbidden("You do not own this listing");
        }
        if (release.status == ReleaseStatus.PUBLISHED
                || release.status == ReleaseStatus.DEPRECATED
                || release.status == ReleaseStatus.YANKED
                || release.status == ReleaseStatus.QUARANTINED) {
            throw new DomainException(StoreErrorCode.INVALID_STATE_TRANSITION,
                    "Only unpublished releases can be deleted (current: "
                            + release.status + ")");
        }
        releases.deleteById(releaseId);
        enqueue(StoreEventPayloads.RELEASE_DELETED, release.id, toJson(
                new StoreEventPayloads.ReleaseDeleted(
                        listing.coordinate().withVersion(release.version).toString(),
                        release.id.toString(), "deleted by publisher")));
        audit.record("USER", userId.toString(), "release.delete", "RELEASE",
                releaseId.toString(), release.status.name(), "publisher delete", null);
    }

    /**
     * Admin cleanup for manually uploaded host update packages: hard-removes the
     * release row so it disappears from the app update feed and the compat
     * mirror immediately. Published releases do NOT need a yank first — removal
     * is the stronger form of the same action. Audited as release.delete, and
     * emits the same outbox event pattern as the other release lifecycle actions
     * so webhook consumers and indexers learn about the removal (audit P3).
     */
    @Transactional
    public void deleteRelease(UUID adminUserId, UUID releaseId, String reason) {
        Release release = releases.findById(releaseId).orElseThrow(
                () -> new DomainException(StoreErrorCode.RELEASE_NOT_FOUND,
                        "Release not found"));
        Listing listing = listings.findById(release.listingId).orElse(null);
        String coordinate = listing == null ? releaseId.toString()
                : listing.coordinate().withVersion(release.version).toString();
        releases.deleteById(releaseId);
        String effectiveReason = reason == null || reason.isBlank()
                ? "admin manual upload cleanup" : reason;
        enqueue(StoreEventPayloads.RELEASE_DELETED, release.id, toJson(
                new StoreEventPayloads.ReleaseDeleted(coordinate, release.id.toString(),
                        effectiveReason)));
        audit.record("USER", adminUserId.toString(), "release.delete", "RELEASE",
                releaseId.toString(), release.status.name(), effectiveReason, null);
    }

    // ---- security withdrawals (design §8.1) ----

    @Transactional
    public Release yank(UUID adminUserId, UUID releaseId, String reason) {
        Release release = loadPublished(releaseId);
        ReleaseStateMachine.assertTransition(release.status, ReleaseStatus.YANKED);
        release.status = ReleaseStatus.YANKED;
        releases.save(release);
        Listing listing = listings.findById(release.listingId).orElse(null);
        String coordinate = listing == null ? releaseId.toString()
                : listing.coordinate().withVersion(release.version).toString();
        enqueue(StoreEventPayloads.RELEASE_YANKED, release.id, toJson(
                new StoreEventPayloads.ReleaseYanked(coordinate, release.id.toString(), reason)));
        audit.record("USER", adminUserId == null ? "system" : adminUserId.toString(),
                "release.yank", "RELEASE", release.id.toString(), null, reason, null);
        return release;
    }

    @Transactional
    public Release quarantine(UUID adminUserId, UUID releaseId, String reason) {
        Release release = loadPublished(releaseId);
        ReleaseStateMachine.assertTransition(release.status, ReleaseStatus.QUARANTINED);
        release.status = ReleaseStatus.QUARANTINED;
        releases.save(release);
        Listing listing = listings.findById(release.listingId).orElse(null);
        String coordinate = listing == null ? releaseId.toString()
                : listing.coordinate().withVersion(release.version).toString();
        enqueue(StoreEventPayloads.RELEASE_QUARANTINED, release.id, toJson(
                new StoreEventPayloads.ReleaseQuarantined(coordinate, release.id.toString(),
                        reason)));
        audit.record("USER", adminUserId == null ? "system" : adminUserId.toString(),
                "release.quarantine", "RELEASE", release.id.toString(), null, reason, null);
        return release;
    }

    public List<PublisherDtos.ScanFindingDto> findingsOf(Review review) {
        return review.findings.stream()
                .map(f -> new PublisherDtos.ScanFindingDto(f.severity(), f.rule(), f.message()))
                .toList();
    }

    private Release loadPublished(UUID releaseId) {
        Release release = releases.findById(releaseId).orElseThrow(
                () -> new DomainException(StoreErrorCode.RELEASE_NOT_FOUND,
                        "Release not found"));
        if (release.status != ReleaseStatus.PUBLISHED && release.status != ReleaseStatus.DEPRECATED) {
            throw new DomainException(StoreErrorCode.INVALID_STATE_TRANSITION,
                    "Only published releases can be withdrawn (current: " + release.status + ")");
        }
        return release;
    }

    private void enqueue(String type, UUID aggregateId, String payloadJson) {
        outbox.enqueue(new OutboxRecord(UuidV7.generate(), "RELEASE", aggregateId.toString(),
                type, payloadJson, OutboxRecord.STATUS_PENDING, 0, Instant.now(), Instant.now()));
    }

    private String toJson(Object payload) {
        try {
            return mapper.writeValueAsString(payload);
        } catch (RuntimeException e) {
            throw new IllegalStateException(e);
        }
    }
}
