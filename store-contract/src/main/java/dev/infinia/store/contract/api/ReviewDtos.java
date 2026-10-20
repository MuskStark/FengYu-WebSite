package dev.infinia.store.contract.api;

import java.util.List;

/** DTOs for moderation and human review (design §8.2). */
public final class ReviewDtos {

    private ReviewDtos() {}

    public record ReviewDto(
            String reviewId,
            String releaseId,
            String listingCoordinate,
            String listingName,
            String version,
            String status,
            String submittedAt,
            String decidedAt,
            String reviewerId,
            String notes,
            List<PublisherDtos.ScanFindingDto> findings) {
    }

    public record ReviewDecisionRequest(String decision, String notes) {}

    public record OrganizationDto(
            String organizationId,
            String slug,
            String name,
            String createdAt) {}

    public record CreateOrganizationRequest(String slug, String name) {}

    public record WebhookDto(
            String webhookId,
            String organizationId,
            String url,
            List<String> events,
            boolean active,
            String createdAt) {}

    public record CreateWebhookRequest(String url, List<String> events) {}

    public record OrganizationMemberDto(
            String userId,
            String email,
            String displayName,
            String role,
            String joinedAt,
            boolean owner) {}

    public record AddMemberRequest(String email, String role) {}

    public record ChangeMemberRoleRequest(String role) {}

    public record AuditEventDto(
            String eventId,
            String actorType,
            String actorId,
            String action,
            String resourceType,
            String resourceId,
            String beforeSummary,
            String afterSummary,
            String traceId,
            String occurredAt) {}

    public record ReportDto(
            String reportId,
            String listingCoordinate,
            String listingName,
            String reason,
            String details,
            String status,
            String resolutionNote,
            String createdAt,
            String resolvedAt) {}

    public record ResolveReportRequest(String resolution, String note) {}

    /**
     * Admin view of one aggregated source. {@code syncStatus} folds the latest
     * sync run into the state the console renders: SYNCING while a run is open,
     * OK/FAILED from the last completed one, null before the first run ever
     * finishes.
     */
    public record UpstreamDto(
            String upstreamId,
            String name,
            String marketplaceUrl,
            String targetNamespace,
            String adapterType,
            boolean enabled,
            String lastSyncAt,
            Boolean lastSyncOk,
            String lastError,
            String syncStatus,
            String lastRunStartedAt,
            Integer lastRunImported,
            Integer lastRunSkipped,
            Integer lastRunFailed) {}

    /** One sync run as shown by the admin sync-log viewer. */
    public record UpstreamSyncRunDto(
            String runId,
            String startedAt,
            String finishedAt,
            int imported,
            int skipped,
            int failed,
            String status,
            List<String> errors) {}

    public record AdminListingDto(
            String listingId,
            String coordinate,
            String name,
            String type,
            String status,
            String visibility,
            String latestVersion,
            boolean featured,
            int minBeeLevel,
            long downloads) {}

    /**
     * Cursor-paged admin console page (same envelope as the catalog page):
     * the console renders a page at a time with server-side text search, so
     * the response no longer scales with the size of the whole catalog.
     */
    public record AdminListingPageDto(
            List<AdminListingDto> items,
            String nextCursor,
            long totalEstimate) {}

    public record UpstreamSyncResultDto(
            String upstream,
            int imported,
            int skipped,
            int failed,
            List<String> errors) {}
}
