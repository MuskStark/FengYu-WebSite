package dev.infinia.store.app.service;

import dev.infinia.store.contract.type.ArtifactKind;
import dev.infinia.store.contract.type.ListingType;
import dev.infinia.store.contract.type.ReleaseStatus;
import dev.infinia.store.domain.model.Listing;
import dev.infinia.store.domain.model.Release;
import dev.infinia.store.domain.model.Review;
import dev.infinia.store.domain.port.ListingRepository;
import dev.infinia.store.domain.port.ReleaseRepository;
import dev.infinia.store.domain.port.PublishingRepositories;
import dev.infinia.store.domain.port.BlobStorage;
import dev.infinia.store.domain.port.IdentityRepositories;
import dev.infinia.store.domain.service.ReleaseStateMachine;
import dev.infinia.store.scanner.PackageScanner;
import dev.infinia.store.scanner.ScanResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Async scan stage of the publishing pipeline (design §8.2). Runs in its own executor
 * so the deployable can move it to dedicated scanner workers later; blocking findings
 * auto-reject, clean packages move the release to human review.
 *
 * <p>Scanning deliberately runs WITHOUT a wrapping transaction: the scan may take
 * minutes, and the outcome is persisted by {@link ScanOutcomeStore} in a fresh,
 * short transaction that re-reads the release row — so a reviewer decision landing
 * mid-scan wins, and the stale scan result is discarded instead of overwriting it
 * (audit P1-4, backed by the release row's optimistic-lock version).
 */
@Component
public class ScanPipeline {

    private static final Logger log = LoggerFactory.getLogger(ScanPipeline.class);

    private final ReleaseRepository releases;
    private final ListingRepository listings;
    private final PublishingRepositories.ReviewRepository reviews;
    private final BlobStorage blobs;
    private final IdentityRepositories.UserRepository users;
    private final PackageScanner scanner = new PackageScanner();
    private final ScanOutcomeStore outcomeStore;

    public ScanPipeline(ReleaseRepository releases, ListingRepository listings,
            PublishingRepositories.ReviewRepository reviews, BlobStorage blobs,
            IdentityRepositories.UserRepository users, ScanOutcomeStore outcomeStore) {
        this.releases = releases;
        this.listings = listings;
        this.reviews = reviews;
        this.blobs = blobs;
        this.users = users;
        this.outcomeStore = outcomeStore;
    }

    /**
     * Entry point invoked after the submitting transaction commits. Also re-invoked
     * by {@link ScanWatchdog} for releases stuck in SCANNING (crashed worker, full
     * executor queue), making the stage self-healing.
     */
    @Async("scanExecutor")
    public void runScan(UUID releaseId, UUID reviewId) {
        ScanWork work;
        try {
            work = performScan(releaseId, reviewId);
        } catch (Exception e) {
            // A crash inside the scan worker (scanner bug, malformed package)
            // must never leave the release wedged in SCANNING. Fail closed:
            // auto-reject in its own transaction.
            log.error("Scan crashed for release {} — auto-rejecting", releaseId, e);
            try {
                outcomeStore.markScanCrashed(releaseId, reviewId,
                        e.getClass().getSimpleName());
            } catch (OptimisticLockingFailureException conflict) {
                log.info("Scan crash cleanup for release {} lost a race — the concurrent"
                        + " decision stands", releaseId);
            } catch (Exception cleanupFailure) {
                log.error("Scan crash cleanup also failed for release {}", releaseId,
                        cleanupFailure);
            }
            return;
        }
        if (work == null) {
            return;
        }
        try {
            boolean applied = outcomeStore.applyScanOutcome(work);
            if (!applied) {
                log.info("Scan result for release {} not applied — the release already"
                        + " moved on (reviewer decision or watchdog outcome stands)",
                        releaseId);
            }
        } catch (OptimisticLockingFailureException conflict) {
            // The reviewer (or another writer) committed between our read and the
            // save: their decision is authoritative, the scan result is dropped.
            log.info("Scan outcome for release {} overtook by a concurrent writer —"
                    + " keeping the concurrent decision", releaseId);
        }
    }

    /** Immutable scan result handed to {@link ScanOutcomeStore}. */
    record ScanWork(UUID releaseId, UUID reviewId, List<Review.Finding> findings,
            boolean blocking, List<Release.PermissionDecl> extractedPermissions) {}

    private ScanWork performScan(UUID releaseId, UUID reviewId) throws IOException {
        // Defensive re-read: with afterCommit scheduling the row is durable already,
        // but a watchdog re-enqueue or replica lag benefits from a short retry.
        Release release = null;
        Review review = null;
        for (int attempt = 0; attempt < 100 && (release == null || review == null); attempt++) {
            try {
                Thread.sleep(20);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
            release = releases.findById(releaseId).orElse(null);
            review = reviews.findById(reviewId).orElse(null);
        }
        if (release == null || review == null) {
            log.error("Scan target missing after retries: release={}", releaseId);
            return null;
        }
        Listing listing = listings.findById(release.listingId).orElse(null);
        // The platform publishing its own packages (official plugins) is the one
        // FengYu-trusted publisher: scanner rules reserving fan.summer.* /
        // official:true relax for listings owned by a PLATFORM_ADMIN. Derived from
        // the listing owner at scan time so watchdog re-scans see the same posture.
        boolean platformTrusted = listing == null || users
                .findById(listing.publisherUserId)
                .map(u -> u.hasRole(dev.infinia.store.contract.type.UserRole.PLATFORM_ADMIN))
                .orElse(false);
        ScanResult result;
        if (listing != null && listing.type == ListingType.APP) {
            result = scanAppArtifacts(release);
        } else {
            Release.ArtifactInfo artifact = release.artifacts.stream()
                    .filter(a -> a.kind() == ArtifactKind.PACKAGE)
                    .findFirst()
                    .orElse(null);
            if (artifact == null) {
                result = new ScanResult();
                result.error("scanner.no-package", "No PACKAGE artifact attached");
            } else {
                result = scanPackage(listing, release, artifact, platformTrusted);
            }
        }
        // Findings key on (rule, message); append the file so hits in different
        // files stay distinct and identical duplicates collapse — a duplicate row
        // would violate pk_review_finding and roll back the whole scan.
        java.util.LinkedHashMap<String, Review.Finding> distinct = new java.util.LinkedHashMap<>();
        for (var f : result.findings) {
            String message = f.file() == null ? f.message()
                    : f.message() + " (" + f.file() + ")";
            distinct.putIfAbsent(f.rule() + "|" + message,
                    new Review.Finding(f.severity(), f.rule(), message));
        }
        return new ScanWork(releaseId, reviewId, new ArrayList<>(distinct.values()),
                result.hasBlockingFindings(), result.extractedPermissions.stream()
                        .map(p -> new Release.PermissionDecl(
                                String.valueOf(p.get("permissionId")), "plugin", true, null))
                        .toList());
    }

    /**
     * Streams the package to a temp file and scans from disk (audit P2-4): the
     * previous implementation buffered the whole artifact (up to the 1 GiB upload
     * cap) in heap. Skill archives take the streaming ZipFile path; other kinds
     * are bounded by the scanner's own read-back limit.
     */
    private ScanResult scanPackage(Listing listing, Release release,
            Release.ArtifactInfo artifact, boolean platformTrusted) {
        Path temp = null;
        try {
            temp = Files.createTempFile("infinia-scan-", ".pkg");
            try (InputStream in = blobs.open(artifact.blobKey());
                    var out = Files.newOutputStream(temp)) {
                in.transferTo(out);
            }
            return scanner.scan(listing == null ? "PLUGIN" : listing.type.name(),
                    release.version.toString(), temp, platformTrusted);
        } catch (IOException e) {
            ScanResult result = new ScanResult();
            result.error("scanner.io", "Package could not be read: " + e.getMessage());
            return result;
        } finally {
            if (temp != null) {
                try {
                    Files.deleteIfExists(temp);
                } catch (IOException ignored) {
                    // temp file cleanup is best-effort; the OS tmp cleaner covers the rest
                }
            }
        }
    }

    /** APP binaries are opaque/code-signed; validate routing metadata without buffering them. */
    private ScanResult scanAppArtifacts(Release release) {
        ScanResult result = new ScanResult();
        java.util.List<Release.ArtifactInfo> binaries = release.artifacts.stream()
                .filter(a -> a.kind() == ArtifactKind.INSTALLER
                        || a.kind() == ArtifactKind.PORTABLE)
                .toList();
        if (binaries.isEmpty()) {
            result = new ScanResult();
            result.error("scanner.no-app-binary", "No APP installer or portable artifact attached");
            return result;
        }
        java.util.HashSet<String> routes = new java.util.HashSet<>();
        for (Release.ArtifactInfo artifact : binaries) {
            String route = artifact.platform() + "/" + artifact.arch() + "/"
                    + artifact.kind() + "/" + artifact.variant();
            if (!routes.add(route)) {
                result.error("app.duplicate-route", "Duplicate APP artifact route " + route);
            }
            if (!blobs.exists(artifact.blobKey()) || artifact.size() <= 0
                    || artifact.sha256() == null
                    || !artifact.sha256().matches("[0-9a-fA-F]{64}")) {
                result.error("app.binary-invalid", "Missing or invalid APP binary metadata: "
                        + artifact.filename());
            }
            result.info("app.binary", "Opaque APP binary queued for platform code-sign review: "
                    + artifact.filename());
        }
        return result;
    }
}
