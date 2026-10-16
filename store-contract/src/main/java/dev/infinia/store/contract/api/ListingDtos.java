package dev.infinia.store.contract.api;

import java.util.List;

/** DTOs for listing details and releases. */
public final class ListingDtos {

    private ListingDtos() {}

    public record LocalizationDto(String locale, String name, String summary, String descriptionMarkdown,
            String changelogMarkdown) {
    }

    public record ListingDetailDto(
            String listingId,
            String coordinate,
            String type,
            String namespace,
            String slug,
            String visibility,
            String status,
            String category,
            String descriptionMarkdown,
            List<String> tags,
            String iconUrl,
            List<String> screenshots,
            String defaultChannel,
            String publisherName,
            long downloads,
            long favorites,
            int minBeeLevel,
            String createdAt,
            String updatedAt,
            List<LocalizationDto> localizations,
            List<ListingReleaseDto> releases,
            UpstreamProvenanceDto upstream) {
    }

    public record UpstreamProvenanceDto(
            String sourceName,
            String externalId,
            String sourceUrl,
            String sourcePath,
            String ref,
            String commitSha,
            String upstreamVersion,
            String metadataSha256,
            String firstSeenAt,
            String lastSeenAt,
            String deliveryMode) {
    }

    public record ListingReleaseDto(
            String releaseId,
            String version,
            String status,
            String channel,
            String publishedAt,
            String createdAt,
            String requiresHost,
            String license,
            String sourceUrl,
            String changelogMarkdown,
            int rolloutPercent,
            List<ArtifactDto> artifacts,
            List<DependencyDto> dependencies,
            List<PermissionDto> permissions) {
    }

    public record ArtifactDto(
            String artifactId,
            String kind,
            String platform,
            String arch,
            String variant,
            String filename,
            long size,
            String sha256,
            String keyId,
            String mimeType) {
    }

    public record DependencyDto(
            String coordinate,
            String range,
            boolean optional) {
    }

    public record PermissionDto(
            String permissionId,
            String scope,
            boolean required,
            String reason) {
    }

    public record RatingDto(
            String ratingId,
            String userId,
            int stars,
            String comment,
            String updatedAt) {
    }

    public record RatingSummaryDto(long count, double average) {}

    public record RatingsPageDto(RatingSummaryDto summary, List<RatingDto> ratings) {}

    public record UpsertRatingRequest(Integer stars, String comment) {}

    public record ReportRequest(String reason, String details) {}
}
