package dev.infinia.store.domain.port;

import dev.infinia.store.contract.coordinate.InfiniaCoordinate;
import dev.infinia.store.contract.type.ListingType;
import dev.infinia.store.domain.model.Listing;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Persistence port for catalog listings. */
public interface ListingRepository {

    Optional<Listing> findById(UUID id);

    Optional<Listing> findByCoordinate(InfiniaCoordinate coordinate);

    List<Listing> findByIds(List<UUID> ids);

    boolean existsByNamespaceAndSlugAndType(String namespace, String slug, ListingType type);

    ListingQuery.ListingPage search(ListingQuery query);

    List<Listing> findByPublisher(UUID publisherUserId);

    /**
     * Paged admin-console search: every listing regardless of visibility/status,
     * newest-updated first, with the text predicate (name/coordinate contains)
     * pushed into SQL. The former {@code findAllForAdmin()} loaded every row and
     * touched the EAGER i18n map per row, and the console then queried releases
     * per listing — five statements per listing, so a catalog of thousands froze
     * the page; this keeps a page at a constant statement count.
     */
    ListingQuery.ListingPage searchForAdmin(String text, String afterId, int limit);

    void save(Listing listing);

    void incrementDownloads(UUID listingId);

    void incrementFavorites(UUID listingId, long delta);
}
