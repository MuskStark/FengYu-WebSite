package dev.infinia.store.infrastructure.persistence.repository;

import dev.infinia.store.infrastructure.persistence.entity.ListingEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ListingJpaRepository extends JpaRepository<ListingEntity, UUID> {

    Optional<ListingEntity> findByNamespaceIdAndSlugAndType(UUID namespaceId, String slug, String type);

    /** Coordinate lookup pushed into SQL — the old variant scanned every listing of the type. */
    Optional<ListingEntity> findByNamespaceAndSlugAndType(String namespace, String slug, String type);

    boolean existsByNamespaceAndSlugAndType(String namespace, String slug, String type);

    List<ListingEntity> findByPublisherUserId(UUID publisherUserId);

    @Query("SELECT l FROM ListingEntity l WHERE (:type IS NULL OR l.type = :type)")
    List<ListingEntity> findAllByOptionalType(@Param("type") String type);

    /** Atomic counter bumps — read-modify-write loses increments under concurrency. */
    @Modifying
    @Query("UPDATE ListingEntity l SET l.downloads = l.downloads + 1 WHERE l.id = :id")
    int incrementDownloads(@Param("id") UUID id);

    @Modifying
    @Query("UPDATE ListingEntity l SET l.favoriteCount = "
            + "CASE WHEN l.favoriteCount + :delta < 0 THEN 0 ELSE l.favoriteCount + :delta END"
            + " WHERE l.id = :id")
    int incrementFavorites(@Param("id") UUID id, @Param("delta") long delta);
}
