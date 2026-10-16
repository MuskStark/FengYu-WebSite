package dev.infinia.store.app.web;

import dev.infinia.store.app.config.StoreProperties;
import dev.infinia.store.app.service.CatalogService;
import dev.infinia.store.app.service.CurrentPrincipal;
import dev.infinia.store.app.service.PublisherService;
import dev.infinia.store.app.service.ReviewService;
import dev.infinia.store.app.service.TicketService;
import dev.infinia.store.contract.api.ListingDtos;
import dev.infinia.store.contract.api.PublisherDtos;
import dev.infinia.store.contract.coordinate.InfiniaCoordinate;
import dev.infinia.store.contract.error.StoreErrorCode;
import dev.infinia.store.domain.DomainException;
import dev.infinia.store.domain.model.Listing;
import dev.infinia.store.domain.model.Namespace;
import dev.infinia.store.domain.model.Organization;
import dev.infinia.store.domain.model.Release;
import dev.infinia.store.domain.model.UploadSessionInfo;
import dev.infinia.store.domain.port.IdentityRepositories;
import dev.infinia.store.domain.port.ListingRepository;
import dev.infinia.store.domain.port.ReleaseRepository;
import dev.infinia.store.domain.service.UuidV7;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Official FengYu plugin (.fyp) releases through the same intranet admin path
 * as {@link AdminAppReleaseController}: the store is the ONLY distribution
 * channel for official plugins (the host never bundles or seeds them), so the
 * publish pipeline needs an endpoint that ensures the conventional
 * {@code fan.summer.<slug>} PLUGIN listing, drafts the release, hands out the
 * presigned upload URL, and publishes immediately on command — the platform
 * admin IS the review decision, exactly like the host-app flow.
 *
 * <p>The {@code fan.summer.} prefix is the official-plugin boundary (the host's
 * P0-8 anti-impersonation reserves that id range): this endpoint accepts
 * nothing else, and it creates the {@code fan.summer} namespace on first use
 * so no other flow can claim it.</p>
 */
@RestController
@RequestMapping("/api/v1/admin/plugin-releases")
public class AdminPluginReleaseController {

    /** Official plugin ids: fan.summer.&lt;slug&gt;. */
    private static final Pattern OFFICIAL_PLUGIN_ID =
            Pattern.compile("fan\\.summer\\.([a-z0-9][a-z0-9-]*)");

    /**
     * {@code version} and {@code channel} are optional — both are inferred from
     * the package filename when omitted ({@code fan.summer.email-4.1.0-beta.1.fyp};
     * a pre-release suffix names the channel, otherwise stable). Listing
     * metadata ({@code name}/{@code summary}/{@code category}) is only read on
     * first-run listing creation; {@code permissions} come from the plugin's
     * manifest.
     */
    record StartUploadRequest(
            String pluginId,
            String version,
            String channel,
            String filename,
            Long size,
            String changelog,
            String requiresHost,
            String sourceUrl,
            String name,
            String summary,
            String category,
            List<String> permissions) {
    }

    record StartUploadResponse(String listingId, String releaseId, String pluginId,
            String version, String channel, String uploadUrl, String method, String kind,
            String platform, String arch, String variant, String expiresAt) {
    }

    record ArtifactSummary(String filename, String kind, String platform, String arch,
            String variant, long size, String sha256) {
    }

    record PluginReleaseSummary(String releaseId, String pluginId, String version,
            String channel, String status, String publishedAt, List<ArtifactSummary> artifacts) {
    }

    record DeleteReasonBody(String reason) {
    }

    private final PublisherService publisher;
    private final ReviewService reviewService;
    private final CatalogService catalog;
    private final ListingRepository listings;
    private final ReleaseRepository releases;
    private final IdentityRepositories.NamespaceRepository namespaces;
    private final IdentityRepositories.OrganizationRepository organizations;
    private final TicketService tickets;
    private final StoreProperties properties;
    private final CurrentPrincipal principal;

    public AdminPluginReleaseController(PublisherService publisher, ReviewService reviewService,
            CatalogService catalog, ListingRepository listings, ReleaseRepository releases,
            IdentityRepositories.NamespaceRepository namespaces,
            IdentityRepositories.OrganizationRepository organizations, TicketService tickets,
            StoreProperties properties, CurrentPrincipal principal) {
        this.publisher = publisher;
        this.reviewService = reviewService;
        this.catalog = catalog;
        this.listings = listings;
        this.releases = releases;
        this.namespaces = namespaces;
        this.organizations = organizations;
        this.tickets = tickets;
        this.properties = properties;
        this.principal = principal;
    }

    /** The plugin's releases, newest first (drafts included). */
    @GetMapping
    public List<PluginReleaseSummary> list(@RequestParam String pluginId) {
        Listing listing = officialListing(validatePluginId(pluginId));
        if (listing == null) {
            return List.of();
        }
        return releases.findByListingId(listing.id).stream()
                .sorted(Comparator.comparing((Release r) -> r.createdAt).reversed())
                .map(r -> toSummary(r, listing))
                .toList();
    }

    /**
     * Start an official-plugin upload: ensures the {@code fan.summer.<slug>}
     * listing exists, drafts the release for {@code version}, and returns the
     * presigned PUT URL for the {@code .fyp} bytes (same ticketed pipeline as
     * the publisher portal; kind/platform/arch default to PACKAGE/universal —
     * a {@code .fyp} is host-platform independent).
     */
    @PostMapping
    public ResponseEntity<StartUploadResponse> start(@RequestBody StartUploadRequest request) {
        UUID adminId = requireAdmin();
        if (request.filename() == null || request.filename().isBlank()) {
            throw new DomainException(StoreErrorCode.VALIDATION_FAILED, "filename is required");
        }
        String filename = request.filename().trim();
        String pluginId = validatePluginId(request.pluginId());
        String version = request.version() == null || request.version().isBlank()
                ? AdminAppReleaseController.inferVersion(filename)
                : request.version().trim();
        String channel = request.channel() == null || request.channel().isBlank()
                ? AdminAppReleaseController.inferChannel(version)
                : request.channel().trim().toLowerCase(Locale.ROOT);
        Listing listing = ensureOfficialListing(adminId, pluginId, request);
        // Manifest permissions are plain ids (files.read, network.email, …) with no
        // scoped resource; the column is NOT NULL, so an unscoped permission carries
        // the empty string rather than null.
        List<ListingDtos.PermissionDto> permissions = request.permissions() == null ? null
                : request.permissions().stream()
                        .map(id -> new ListingDtos.PermissionDto(id, "", true, null))
                        .toList();
        Release release = publisher.createDraftRelease(adminId, true, listing,
                new PublisherDtos.CreateReleaseRequest(version, channel, request.requiresHost(),
                        "GPL-3.0", request.sourceUrl(),
                        request.changelog() == null || request.changelog().isBlank()
                                ? pluginId + " " + version
                                : request.changelog(),
                        null, permissions, null));
        UploadSessionInfo session = publisher.createUploadSession(adminId, true, release,
                filename, null, null, null, null,
                request.size() == null ? 0 : request.size());
        Instant expiresAt = session.expiresAt;
        String signature = tickets.sign("upload", session.id.toString(), expiresAt);
        String uploadUrl = "/api/v1/blobs/uploads/" + session.id + "?"
                + TicketService.encodeTicketParams("upload", session.id.toString(), expiresAt,
                        signature);
        return ResponseEntity.status(HttpStatus.CREATED).body(new StartUploadResponse(
                listing.id.toString(), release.id.toString(), pluginId, version,
                release.channel.name().toLowerCase(), uploadUrl, "PUT",
                session.kind.name(), session.platform.name().toLowerCase(),
                session.arch.name().toLowerCase(), session.variant, expiresAt.toString()));
    }

    /**
     * Publish an uploaded official-plugin release immediately (signing the
     * envelope and every artifact like an approval). Only freshly uploaded
     * releases qualify; the FengYu compat catalog serves it as soon as it is
     * PUBLISHED.
     */
    @PostMapping("/{releaseId}/publish")
    public PluginReleaseSummary publish(@PathVariable UUID releaseId) {
        UUID adminId = requireAdmin();
        Release release = catalog.releaseOrThrow(releaseId);
        Listing listing = listings.findById(release.listingId)
                .orElseThrow(() -> new DomainException(StoreErrorCode.LISTING_NOT_FOUND,
                        "Listing not found"));
        return toSummary(reviewService.publishAdminUpload(adminId, release), listing);
    }

    /**
     * Delete an official-plugin release (any status — removal supersedes a
     * yank). The compat catalog stops serving it immediately.
     */
    @DeleteMapping("/{releaseId}")
    public ResponseEntity<Void> delete(@PathVariable UUID releaseId,
            @RequestBody(required = false) DeleteReasonBody body) {
        reviewService.deleteRelease(requireAdmin(), releaseId,
                body == null ? null : body.reason());
        return ResponseEntity.noContent().build();
    }

    // ---- helpers ----

    /** Validates and normalizes an official plugin id ({@code fan.summer.<slug>}). */
    static String validatePluginId(String pluginId) {
        if (pluginId == null) {
            throw new DomainException(StoreErrorCode.VALIDATION_FAILED,
                    "pluginId is required (fan.summer.<slug>)");
        }
        String trimmed = pluginId.trim().toLowerCase(Locale.ROOT);
        if (!OFFICIAL_PLUGIN_ID.matcher(trimmed).matches()) {
            throw new DomainException(StoreErrorCode.VALIDATION_FAILED,
                    "pluginId must be an official plugin id (fan.summer.<slug>): " + pluginId);
        }
        return trimmed;
    }

    /** The conventional official listing, or null when nothing was uploaded yet. */
    private Listing officialListing(String pluginId) {
        String slug = pluginId.substring("fan.summer.".length());
        return listings.findByCoordinate(InfiniaCoordinate.of(
                dev.infinia.store.contract.type.ListingType.PLUGIN, "fan.summer", slug))
                .orElse(null);
    }

    /**
     * Finds the conventional listing, creating it (and reserving the
     * {@code fan.summer} namespace) on first use. The listing is owned by the
     * admin, but the PLATFORM_ADMIN bypass lets later uploads work no matter
     * who owns it (the CI account, for example).
     */
    private Listing ensureOfficialListing(UUID adminId, String pluginId,
            StartUploadRequest request) {
        Listing existing = officialListing(pluginId);
        if (existing != null) {
            return existing;
        }
        String slug = pluginId.substring("fan.summer.".length());
        if (namespaces.findByName("fan.summer").isEmpty()) {
            // Creating an organization reserves the matching namespace (design
            // §7.1) — the org slug validation is bypassed deliberately because
            // the official namespace is dotted, exactly like the app-release
            // first-run path.
            Instant now = Instant.now();
            UUID orgId = UuidV7.generate();
            organizations.save(new Organization(orgId, "fan.summer",
                    "FengYu Official Plugins", adminId, now));
            organizations.addMember(new Organization.Member(orgId, adminId,
                    dev.infinia.store.contract.type.UserRole.ORG_ADMIN, now));
            namespaces.save(new Namespace(UuidV7.generate(), "fan.summer", null,
                    orgId, false, now));
        }
        return publisher.createListing(adminId, true, new PublisherDtos.CreateListingRequest(
                "fan.summer", slug, "PLUGIN",
                request.category() == null || request.category().isBlank()
                        ? "Productivity" : request.category(),
                List.of("fengyu", "official"), null,
                request.name() == null || request.name().isBlank() ? pluginId : request.name(),
                request.summary() == null || request.summary().isBlank()
                        ? "Official FengYu plugin " + pluginId : request.summary(),
                null, null, null));
    }

    /** Security chain gates /api/v1/admin/** to PLATFORM_ADMIN; assert it again. */
    private UUID requireAdmin() {
        var current = principal.require();
        if (!current.hasRole("PLATFORM_ADMIN")) {
            throw DomainException.forbidden("Platform admin role required");
        }
        return current.userId();
    }

    private static PluginReleaseSummary toSummary(Release release, Listing listing) {
        String pluginId = listing.namespace + "." + listing.slug;
        return new PluginReleaseSummary(release.id.toString(), pluginId,
                release.version.toString(), release.channel.name().toLowerCase(),
                release.status.name(),
                release.publishedAt == null ? null : release.publishedAt.toString(),
                release.artifacts.stream()
                        .map(a -> new ArtifactSummary(a.filename(), a.kind().name().toLowerCase(),
                                a.platform().name().toLowerCase(), a.arch().name().toLowerCase(),
                                a.variant(), a.size(), a.sha256()))
                        .toList());
    }
}
