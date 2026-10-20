package dev.infinia.store.app.web;

import dev.infinia.store.app.service.AuditService;
import dev.infinia.store.app.service.BeeLevelService;
import dev.infinia.store.app.service.CatalogService;
import dev.infinia.store.app.service.CurrentPrincipal;
import dev.infinia.store.app.service.ModerationService;
import dev.infinia.store.contract.api.ReviewDtos;
import dev.infinia.store.domain.model.Listing;
import dev.infinia.store.domain.model.ListingReport;
import dev.infinia.store.domain.port.ListingQuery;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/** Abuse reports filed by signed-in users (design §12.4 举报). */
@RestController
@RequestMapping("/api/v1")
class ReportsController {

    private final ModerationService moderation;
    private final CatalogService catalog;
    private final CurrentPrincipal principal;
    private final BeeLevelService beeLevels;

    ReportsController(ModerationService moderation, CatalogService catalog,
            CurrentPrincipal principal, BeeLevelService beeLevels) {
        this.moderation = moderation;
        this.catalog = catalog;
        this.principal = principal;
        this.beeLevels = beeLevels;
    }

    @PostMapping("/reports")
    public ResponseEntity<ReviewDtos.ReportDto> report(@RequestBody ReportBody body) {
        UUID reporterId = principal.requireUserId();
        Listing listing = catalog.listingOrThrow(
                dev.infinia.store.contract.coordinate.InfiniaCoordinate.parse(body.coordinate()));
        // Reporting a bee-level gated listing requires meeting the gate (蜜蜂等级).
        beeLevels.requireListingAccess(listing);
        ListingReport record = moderation.report(reporterId, listing, body.reason(), body.details());
        return ResponseEntity.status(HttpStatus.CREATED).body(toDto(record, listing));
    }

    record ReportBody(String coordinate, String reason, String details) {}

    static ReviewDtos.ReportDto toDto(ListingReport record, Listing listing) {
        return new ReviewDtos.ReportDto(record.id().toString(),
                listing == null ? record.listingId().toString() : listing.coordinate().toString(),
                listing == null ? null : listing.name("en"), record.reason(), record.details(),
                record.status(), record.resolutionNote(), record.createdAt().toString(),
                record.resolvedAt() == null ? null : record.resolvedAt().toString());
    }
}

/**
 * Platform-admin console (design §12.4 管理): report queue resolution and the audit
 * trail reader. Yank/quarantine live in {@link ReviewController}.
 */
@RestController
@RequestMapping("/api/v1/admin")
class AdminController {

    private final ModerationService moderation;
    private final AuditService audit;
    private final CurrentPrincipal principal;
    private final dev.infinia.store.domain.port.ListingRepository listings;
    private final dev.infinia.store.domain.port.ReleaseRepository releases;
    private final dev.infinia.store.app.service.ReviewService reviews;

    AdminController(ModerationService moderation, AuditService audit,
            CurrentPrincipal principal,
            dev.infinia.store.domain.port.ListingRepository listings,
            dev.infinia.store.domain.port.ReleaseRepository releases,
            dev.infinia.store.app.service.ReviewService reviews) {
        this.moderation = moderation;
        this.audit = audit;
        this.principal = principal;
        this.listings = listings;
        this.releases = releases;
        this.reviews = reviews;
    }

    // ---- listing curation (design §12.4 管理: 上下架/推荐) ----

    /**
     * Every listing in every visibility/status — the admin console view.
     * Cursor-paged with the text search pushed into SQL: the former
     * load-everything pass ran five statements per listing (row + EAGER i18n +
     * release + three release collections), which froze the console on
     * catalogs of thousands. A page costs a constant handful of statements.
     */
    @GetMapping("/listings")
    public ReviewDtos.AdminListingPageDto allListings(
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String after,
            @RequestParam(required = false, defaultValue = "50") Integer limit) {
        principal.requireUserId();
        int bounded = Math.clamp(limit == null ? 50 : limit, 1, 200);
        ListingQuery.ListingPage page = listings.searchForAdmin(query, after, bounded);
        java.util.Map<UUID, dev.infinia.store.contract.semver.SemVer> latest =
                releases.findLatestVisibleVersions(
                        page.items().stream().map(l -> l.id).toList());
        List<ReviewDtos.AdminListingDto> items = page.items().stream()
                .map(l -> toAdminDto(l, latest.get(l.id)))
                .toList();
        return new ReviewDtos.AdminListingPageDto(items,
                page.hasMore() ? page.lastId() : null, page.totalEstimate());
    }

    /** List (PUBLIC) or delist (UNLISTED) a listing — hides it from every catalog. */
    @PostMapping("/listings/{listingId}/visibility")
    public ReviewDtos.AdminListingDto visibility(@PathVariable java.util.UUID listingId,
            @RequestBody VisibilityBody body) {
        java.util.UUID admin = principal.requireUserId();
        String visibility = body.visibility() == null ? "" : body.visibility().trim()
                .toUpperCase();
        if (!"PUBLIC".equals(visibility) && !"UNLISTED".equals(visibility)) {
            throw new dev.infinia.store.domain.DomainException(
                    dev.infinia.store.contract.error.StoreErrorCode.VALIDATION_FAILED,
                    "visibility must be PUBLIC or UNLISTED");
        }
        dev.infinia.store.domain.model.Listing listing = listings.findById(listingId)
                .orElseThrow(() -> new dev.infinia.store.domain.DomainException(
                        dev.infinia.store.contract.error.StoreErrorCode.LISTING_NOT_FOUND,
                        "Listing not found"));
        String before = listing.visibility.name();
        listing.visibility = dev.infinia.store.contract.type.ListingVisibility
                .valueOf(visibility);
        listing.updatedAt = java.time.Instant.now();
        listings.save(listing);
        audit.record("USER", admin.toString(), "listing.visibility", "LISTING",
                listing.id.toString(), before, visibility, null);
        return toAdminDto(listing);
    }

    /** Editorial featuring — drives the store's featured shelf. */
    @PostMapping("/listings/{listingId}/featured")
    public ReviewDtos.AdminListingDto featured(@PathVariable java.util.UUID listingId,
            @RequestBody FeaturedBody body) {
        java.util.UUID admin = principal.requireUserId();
        dev.infinia.store.domain.model.Listing listing = listings.findById(listingId)
                .orElseThrow(() -> new dev.infinia.store.domain.DomainException(
                        dev.infinia.store.contract.error.StoreErrorCode.LISTING_NOT_FOUND,
                        "Listing not found"));
        listing.featured = Boolean.TRUE.equals(body.featured());
        listing.updatedAt = java.time.Instant.now();
        listings.save(listing);
        audit.record("USER", admin.toString(), "listing.featured", "LISTING",
                listing.id.toString(), String.valueOf(!listing.featured),
                String.valueOf(listing.featured), null);
        return toAdminDto(listing);
    }

    /**
     * Adjust the listing's bee-level gate (蜜蜂等级门槛): 0 keeps it public for
     * everyone including anonymous visitors; 1..4 restricts view and download
     * to signed-in accounts at or above that hive level.
     */
    @PostMapping("/listings/{listingId}/min-bee-level")
    public ReviewDtos.AdminListingDto minBeeLevel(@PathVariable java.util.UUID listingId,
            @RequestBody MinBeeLevelBody body) {
        java.util.UUID admin = principal.requireUserId();
        dev.infinia.store.domain.model.Listing listing = listings.findById(listingId)
                .orElseThrow(() -> new dev.infinia.store.domain.DomainException(
                        dev.infinia.store.contract.error.StoreErrorCode.LISTING_NOT_FOUND,
                        "Listing not found"));
        java.lang.Integer requested = body == null ? null : body.minBeeLevel();
        if (requested == null || !dev.infinia.store.contract.type.BeeLevel.isValid(requested)) {
            throw new dev.infinia.store.domain.DomainException(
                    dev.infinia.store.contract.error.StoreErrorCode.VALIDATION_FAILED,
                    "Minimum Infinia Level (minBeeLevel) must be 0 (public) through "
                            + dev.infinia.store.contract.type.BeeLevel.MAX_LEVEL + " (QUEEN)");
        }
        int before = listing.minBeeLevel;
        listing.minBeeLevel = requested;
        listing.updatedAt = java.time.Instant.now();
        listings.save(listing);
        audit.record("USER", admin.toString(), "listing.minBeeLevel", "LISTING",
                listing.id.toString(), "L" + before, "L" + requested, null);
        return toAdminDto(listing);
    }

    private ReviewDtos.AdminListingDto toAdminDto(dev.infinia.store.domain.model.Listing l) {
        return toAdminDto(l, releases.findLatestVisibleVersions(List.of(l.id)).get(l.id));
    }

    private ReviewDtos.AdminListingDto toAdminDto(dev.infinia.store.domain.model.Listing l,
            dev.infinia.store.contract.semver.SemVer latest) {
        return new ReviewDtos.AdminListingDto(l.id.toString(), l.coordinate().toString(),
                l.name("en"), l.type.name(), l.status, l.visibility.name(),
                latest == null ? null : latest.toString(),
                l.featured, l.minBeeLevel, l.downloads);
    }

    /**
     * Publish a scan-rejected release after manual review — the documented escape
     * hatch for scanner false positives (design §15.3), fully audited.
     */
    @PostMapping("/releases/{releaseId}/force-publish")
    public ResponseEntity<java.util.Map<String, String>> forcePublish(
            @PathVariable java.util.UUID releaseId,
            @RequestBody ReasonBody body) {
        principal.requireUserId();
        var published = reviews.forcePublish(principal.requireUserId(), releaseId,
                body == null || body.reason() == null ? "" : body.reason());
        return ResponseEntity.ok().body(java.util.Map.of(
                "releaseId", published.id.toString(),
                "status", published.status.name()));
    }

    record ReasonBody(String reason) {}

    record VisibilityBody(String visibility) {}

    record FeaturedBody(Boolean featured) {}

    record MinBeeLevelBody(Integer minBeeLevel) {}

    @GetMapping("/reports")
    public List<ReviewDtos.ReportDto> reports(@RequestParam(required = false) String status) {
        return moderation.reportQueue(status).stream()
                .map(r -> ReportsController.toDto(r, moderation.listingOfReport(r)))
                .toList();
    }

    @PostMapping("/reports/{reportId}/resolution")
    public ReviewDtos.ReportDto resolve(@PathVariable UUID reportId,
            @RequestBody ReviewDtos.ResolveReportRequest request) {
        ListingReport resolved = moderation.resolveReport(principal.requireUserId(), reportId,
                request.resolution(), request.note());
        return ReportsController.toDto(resolved, moderation.listingOfReport(resolved));
    }

    @GetMapping("/audit-events")
    public List<ReviewDtos.AuditEventDto> auditEvents(
            @RequestParam(required = false) String resourceType,
            @RequestParam(required = false, defaultValue = "100") Integer limit) {
        int bounded = limit == null ? 100 : Math.clamp(limit, 1, 200);
        return audit.recent(bounded, resourceType).stream()
                .map(e -> new ReviewDtos.AuditEventDto(e.id().toString(), e.actorType(),
                        e.actorId(), e.action(), e.resourceType(), e.resourceId(),
                        e.beforeSummary(), e.afterSummary(), e.traceId(),
                        e.occurredAt().toString()))
                .toList();
    }
}
