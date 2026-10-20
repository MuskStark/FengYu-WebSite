package dev.infinia.store.domain.port;

import dev.infinia.store.contract.type.Channel;
import dev.infinia.store.contract.type.ListingType;
import dev.infinia.store.contract.type.ReleaseStatus;
import dev.infinia.store.domain.model.Release;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Persistence port for releases. */
public interface ReleaseRepository {

    Optional<Release> findById(UUID id);

    List<Release> findByListingId(UUID listingId);

    Optional<Release> findByListingIdAndVersion(UUID listingId, String version);

    /** Releases currently in one status — the scan watchdog reconciles stuck SCANNING rows. */
    List<Release> findByStatus(ReleaseStatus status);

    /** Highest published (or deprecated) release of a listing in a channel. */
    Optional<Release> findLatestVisible(UUID listingId, Channel channel);

    /** All currently published releases of one listing across channels. */
    List<Release> findVisibleByListingId(UUID listingId);

    /**
     * Visible (published/deprecated) releases of many listings in one query —
     * catalog pages batch this instead of a lookup per listing.
     */
    List<Release> findVisibleByListingIds(java.util.Collection<UUID> listingIds);

    /**
     * Newest visible version per listing in one projection query. The admin
     * console only needs the version string; loading full release aggregates
     * would drag their artifact/dependency/permission collections along
     * (three statements per release), which is what froze the console page.
     */
    java.util.Map<UUID, dev.infinia.store.contract.semver.SemVer>
            findLatestVisibleVersions(java.util.Collection<UUID> listingIds);

    /** All published releases of a given type — used by the app update feed. */
    List<Release> findVisibleByType(ListingType type);

    /** Release owning an artifact by blob key — pass-through downloads need its version. */
    Optional<Release> findByArtifactBlobKey(String blobKey);

    void save(Release release);

    /** Admin manual-upload cleanup: hard-removes the release row and its artifacts. */
    void deleteById(UUID id);
}
