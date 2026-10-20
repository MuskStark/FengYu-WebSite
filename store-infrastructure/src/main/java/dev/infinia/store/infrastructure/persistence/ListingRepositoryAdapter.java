package dev.infinia.store.infrastructure.persistence;

import dev.infinia.store.contract.coordinate.InfiniaCoordinate;
import dev.infinia.store.contract.type.Channel;
import dev.infinia.store.contract.type.ListingType;
import dev.infinia.store.contract.type.ListingVisibility;
import dev.infinia.store.domain.model.Listing;
import dev.infinia.store.domain.port.ListingQuery;
import dev.infinia.store.domain.port.ListingRepository;
import dev.infinia.store.infrastructure.persistence.entity.ListingEntity;
import dev.infinia.store.infrastructure.persistence.repository.ListingJpaRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Adapter for {@link ListingRepository}. Catalog search is pushed into SQL
 * (filter + keyset seek + limit + count) with the i18n map joined in a second
 * batched fetch: the table carries tens of thousands of upstream rows, and the
 * former load-everything-then-filter-in-Java pass turned every catalog request
 * into tens of thousands of statements. ADR-008's PostgreSQL FTS upgrade path
 * remains open for ranking; LIKE matching reproduces the old contains()
 * semantics one-for-one.
 */
@Component
public class ListingRepositoryAdapter implements ListingRepository {

    private final ListingJpaRepository jpa;

    @PersistenceContext
    private EntityManager em;

    public ListingRepositoryAdapter(ListingJpaRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public Optional<Listing> findById(UUID id) {
        return jpa.findById(id).map(ListingRepositoryAdapter::toDomain);
    }

    @Override
    public Optional<Listing> findByCoordinate(InfiniaCoordinate coordinate) {
        return jpa.findByNamespaceAndSlugAndType(
                coordinate.namespace, coordinate.slug, coordinate.type.name())
                .map(ListingRepositoryAdapter::toDomain);
    }

    @Override
    public List<Listing> findByIds(List<UUID> ids) {
        List<Listing> result = new ArrayList<>();
        for (ListingEntity e : jpa.findAllById(ids)) {
            result.add(toDomain(e));
        }
        return result;
    }

    @Override
    public boolean existsByNamespaceAndSlugAndType(String namespace, String slug, ListingType type) {
        return jpa.existsByNamespaceAndSlugAndType(namespace, slug, type.name());
    }

    @Override
    public ListingQuery.ListingPage search(ListingQuery query) {
        SortKey sort = SortKey.of(query.sort());

        // Cursor seek needs the cursor row's sort value to build the keyset
        // predicate; a cursor that no longer resolves (deleted/delisted between
        // pages, or garbage input) yields an empty page, which stops any walking
        // client exactly like the old unmatched seek did.
        Seek seek = null;
        if (query.afterId() != null && !query.afterId().isBlank()) {
            UUID cursorId;
            try {
                cursorId = UUID.fromString(query.afterId());
            } catch (IllegalArgumentException e) {
                return emptyPage();
            }
            ListingEntity cursor = jpa.findById(cursorId).orElse(null);
            if (cursor == null) {
                return emptyPage();
            }
            seek = new Seek(cursorId, sort.value(cursor));
        }

        List<UUID> ids = pagedIds(query, sort, seek, query.limit() + 1);
        boolean hasMore = ids.size() > query.limit();
        if (hasMore) {
            ids = ids.subList(0, query.limit());
        }
        List<Listing> page = loadWithLocalizations(ids);
        long total = countMatched(query);

        Listing last = page.isEmpty() ? null : page.get(page.size() - 1);
        return new ListingQuery.ListingPage(page, hasMore,
                last == null ? null : sort.stringValue(last),
                last == null ? null : last.id.toString(), total);
    }

    private static ListingQuery.ListingPage emptyPage() {
        return new ListingQuery.ListingPage(List.of(), false, null, null, 0);
    }

    /** Sort keys and their whitelisted HQL path fragment (all sort DESC, id ASC). */
    private enum SortKey {
        DOWNLOADS("downloads"), RECENT("updatedAt"), FAVORITES("favoriteCount");

        final String column;

        SortKey(String column) {
            this.column = column;
        }

        static SortKey of(ListingQuery.ListingSort sort) {
            return switch (sort == null ? ListingQuery.ListingSort.RELEVANCE : sort) {
                case RECENT -> RECENT;
                case FAVORITES -> FAVORITES;
                case DOWNLOADS, RELEVANCE -> DOWNLOADS;
            };
        }

        Object value(ListingEntity e) {
            return switch (this) {
                case DOWNLOADS -> e.downloads;
                case RECENT -> e.updatedAt;
                case FAVORITES -> e.favoriteCount;
            };
        }

        Object value(Listing l) {
            return switch (this) {
                case DOWNLOADS -> l.downloads;
                case RECENT -> l.updatedAt;
                case FAVORITES -> l.favoriteCount;
            };
        }

        /** Wire-format sort value for the page record (old in-memory semantics). */
        String stringValue(Listing l) {
            return String.valueOf(value(l));
        }
    }

    private record Seek(UUID id, Object value) {}

    private List<UUID> pagedIds(ListingQuery query, SortKey sort, Seek seek, int limit) {
        StringBuilder hql = new StringBuilder("select l.id from ListingEntity l where");
        Map<String, Object> params = new LinkedHashMap<>();
        appendVisibilityAndFilters(query, hql, params);
        if (seek != null) {
            hql.append(" and (l.").append(sort.column).append(" < :seekValue")
                    .append(" or (l.").append(sort.column).append(" = :seekValue")
                    .append(" and l.id > :seekId))");
            params.put("seekValue", seek.value());
            params.put("seekId", seek.id());
        }
        hql.append(" order by l.").append(sort.column).append(" desc, l.id asc");
        var q = em.createQuery(hql.toString(), UUID.class).setMaxResults(limit);
        params.forEach(q::setParameter);
        return q.getResultList();
    }

    private long countMatched(ListingQuery query) {
        StringBuilder hql = new StringBuilder("select count(l) from ListingEntity l where");
        Map<String, Object> params = new LinkedHashMap<>();
        appendVisibilityAndFilters(query, hql, params);
        var q = em.createQuery(hql.toString(), Long.class);
        params.forEach(q::setParameter);
        return q.getSingleResult();
    }

    /** Shared WHERE: visibility/status + bee gate + category + featured + text. */
    private static void appendVisibilityAndFilters(ListingQuery query, StringBuilder hql,
            Map<String, Object> params) {
        hql.append(" l.visibility = 'PUBLIC' and l.status = 'ACTIVE'");
        if (query.type() != null) {
            hql.append(" and l.type = :type");
            params.put("type", query.type().name());
        }
        // Bee-level gate (蜜蜂等级): gate 0 stays public for everyone; gated
        // listings ranked above the viewer's level are invisible — same rule
        // the detail and delivery surfaces apply.
        hql.append(" and (l.minBeeLevel = 0 or l.minBeeLevel <= :viewerBeeLevel)");
        params.put("viewerBeeLevel", query.viewerBeeLevel());
        if (query.category() != null && !query.category().isBlank()) {
            hql.append(" and (l.category is not null and lower(l.category) = lower(:category))");
            params.put("category", query.category());
        }
        if (query.featured() != null) {
            hql.append(" and l.featured = :featured");
            params.put("featured", query.featured());
        }
        String text = query.text() == null ? null : query.text().toLowerCase(Locale.ROOT).trim();
        if (text != null && !text.isEmpty()) {
            // Contains-match over slug, namespace, category, the serialized tag
            // column and the i18n map — mirrors the old in-memory matchesText.
            hql.append(" and (lower(l.slug) like :textMatch")
                    .append(" or lower(l.namespace) like :textMatch")
                    .append(" or (l.category is not null and lower(l.category) like :textMatch)")
                    .append(" or lower(l.tags) like :textMatch")
                    .append(" or exists (select l2.id from ListingEntity l2 join l2.localizations loc")
                    .append(" where l2.id = l.id and (lower(loc.name) like :textMatch")
                    .append(" or (loc.summary is not null and lower(loc.summary) like :textMatch))))");
            params.put("textMatch", "%" + text + "%");
        }
    }

    /**
     * Fetches listing rows in cursor order with the i18n map join-fetched in one
     * statement: the collection fetch duplicates rows per locale, so re-dedup by
     * id and reorder to the paged sequence.
     */
    private List<Listing> loadWithLocalizations(List<UUID> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        List<ListingEntity> rows = em.createQuery(
                "select l from ListingEntity l left join fetch l.localizations where l.id in :ids",
                ListingEntity.class)
                .setParameter("ids", ids)
                .getResultList();
        Map<UUID, ListingEntity> byId = new LinkedHashMap<>();
        for (ListingEntity e : rows) {
            byId.putIfAbsent(e.id, e);
        }
        List<Listing> result = new ArrayList<>(ids.size());
        for (UUID id : ids) {
            ListingEntity e = byId.get(id);
            if (e != null) {
                result.add(toDomain(e));
            }
        }
        return result;
    }

    @Override
    public List<Listing> findByPublisher(UUID publisherUserId) {
        return jpa.findByPublisherUserId(publisherUserId).stream()
                .map(ListingRepositoryAdapter::toDomain).toList();
    }

    @Override
    public ListingQuery.ListingPage searchForAdmin(String text, String afterId, int limit) {
        Seek seek = null;
        if (afterId != null && !afterId.isBlank()) {
            UUID cursorId;
            try {
                cursorId = UUID.fromString(afterId);
            } catch (IllegalArgumentException e) {
                return emptyPage();
            }
            ListingEntity cursor = jpa.findById(cursorId).orElse(null);
            if (cursor == null) {
                return emptyPage();
            }
            seek = new Seek(cursorId, cursor.updatedAt);
        }

        List<UUID> ids = adminPagedIds(text, seek, limit + 1);
        boolean hasMore = ids.size() > limit;
        if (hasMore) {
            ids = ids.subList(0, limit);
        }
        List<Listing> page = loadWithLocalizations(ids);
        long total = countForAdmin(text);

        Listing last = page.isEmpty() ? null : page.get(page.size() - 1);
        return new ListingQuery.ListingPage(page, hasMore,
                last == null ? null : SortKey.RECENT.stringValue(last),
                last == null ? null : last.id.toString(), total);
    }

    /**
     * Admin console page ids: every visibility/status (the console curates
     * delisted and pending rows too), newest-updated first, keyset-seeked on
     * the same (updatedAt desc, id asc) tuple as the RECENT catalog sort.
     */
    private List<UUID> adminPagedIds(String text, Seek seek, int limit) {
        StringBuilder hql = new StringBuilder("select l.id from ListingEntity l where 1=1");
        Map<String, Object> params = new LinkedHashMap<>();
        appendAdminTextFilter(text, hql, params);
        if (seek != null) {
            hql.append(" and (l.updatedAt < :seekValue")
                    .append(" or (l.updatedAt = :seekValue and l.id > :seekId))");
            params.put("seekValue", seek.value());
            params.put("seekId", seek.id());
        }
        hql.append(" order by l.updatedAt desc, l.id asc");
        var q = em.createQuery(hql.toString(), UUID.class).setMaxResults(limit);
        params.forEach(q::setParameter);
        return q.getResultList();
    }

    private long countForAdmin(String text) {
        StringBuilder hql = new StringBuilder("select count(l) from ListingEntity l where 1=1");
        Map<String, Object> params = new LinkedHashMap<>();
        appendAdminTextFilter(text, hql, params);
        var q = em.createQuery(hql.toString(), Long.class);
        params.forEach(q::setParameter);
        return q.getSingleResult();
    }

    /** Admin text filter: coordinate parts (namespace/slug/type) or any i18n name. */
    private static void appendAdminTextFilter(String text, StringBuilder hql,
            Map<String, Object> params) {
        String t = text == null ? null : text.toLowerCase(Locale.ROOT).trim();
        if (t == null || t.isEmpty()) {
            return;
        }
        hql.append(" and (lower(l.slug) like :textMatch")
                .append(" or lower(l.namespace) like :textMatch")
                .append(" or lower(l.type) like :textMatch")
                .append(" or exists (select l2.id from ListingEntity l2 join l2.localizations loc")
                .append(" where l2.id = l.id and lower(loc.name) like :textMatch))");
        params.put("textMatch", "%" + t + "%");
    }

    @Override
    @Transactional
    public void save(Listing listing) {
        ListingEntity entity = jpa.findById(listing.id).orElseGet(ListingEntity::new);
        copy(listing, entity);
        jpa.save(entity);
    }

    @Override
    @Transactional
    public void incrementDownloads(UUID listingId) {
        jpa.incrementDownloads(listingId);
    }

    @Override
    @Transactional
    public void incrementFavorites(UUID listingId, long delta) {
        jpa.incrementFavorites(listingId, delta);
    }

    private static void copy(Listing l, ListingEntity e) {
        e.id = l.id;
        e.namespaceId = l.namespaceId;
        e.namespace = l.namespace;
        e.slug = l.slug;
        e.type = l.type.name();
        e.visibility = l.visibility.name();
        e.status = l.status;
        e.category = l.category;
        e.tags = l.tags == null ? new ArrayList<>() : new ArrayList<>(l.tags);
        e.iconUrl = l.iconUrl;
        e.screenshots = l.screenshots == null ? new ArrayList<>() : new ArrayList<>(l.screenshots);
        e.defaultChannel = (l.defaultChannel == null ? Channel.STABLE : l.defaultChannel).name();
        e.publisherUserId = l.publisherUserId;
        e.organizationId = l.organizationId;
        e.downloads = l.downloads;
        e.favoriteCount = l.favoriteCount;
        e.featured = l.featured;
        e.minBeeLevel = l.minBeeLevel;
        e.createdAt = l.createdAt;
        e.updatedAt = l.updatedAt;
        e.localizations.clear();
        if (l.localizations != null) {
            for (Listing.Localization loc : l.localizations) {
                e.localizations.put(loc.locale(), new ListingEntity.LocalizationEmb(
                        loc.name(), loc.summary(), loc.descriptionMarkdown(), loc.changelogMarkdown()));
            }
        }
    }

    public static Listing toDomain(ListingEntity e) {
        Listing l = new Listing();
        l.id = e.id;
        l.namespaceId = e.namespaceId;
        l.namespace = e.namespace;
        l.slug = e.slug;
        l.type = ListingType.valueOf(e.type);
        l.visibility = ListingVisibility.valueOf(e.visibility);
        l.status = e.status;
        l.category = e.category;
        l.tags = e.tags == null ? new ArrayList<>() : new ArrayList<>(e.tags);
        l.iconUrl = e.iconUrl;
        l.screenshots = e.screenshots == null ? new ArrayList<>() : new ArrayList<>(e.screenshots);
        l.defaultChannel = Channel.valueOf(e.defaultChannel);
        l.publisherUserId = e.publisherUserId;
        l.organizationId = e.organizationId;
        l.downloads = e.downloads;
        l.favoriteCount = e.favoriteCount;
        l.featured = e.featured != null && e.featured;
        l.minBeeLevel = e.minBeeLevel;
        l.createdAt = e.createdAt;
        l.updatedAt = e.updatedAt;
        l.localizations = new ArrayList<>();
        e.localizations.forEach((locale, emb) -> l.localizations.add(new Listing.Localization(
                locale, emb.name(), emb.summary(), emb.descriptionMarkdown(), emb.changelogMarkdown())));
        return l;
    }
}
