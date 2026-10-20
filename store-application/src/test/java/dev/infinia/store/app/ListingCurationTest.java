package dev.infinia.store.app;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Platform-admin curation (design §12.4 管理): every listing can be delisted
 * (UNLISTED — hidden from all catalogs) and editorially featured (drives the
 * store's featured shelf). All actions are admin-only and audited.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class ListingCurationTest {

    @LocalServerPort
    int port;

    @Autowired
    dev.infinia.store.domain.port.ListingRepository listings;

    @Autowired
    dev.infinia.store.domain.port.IdentityRepositories.UserRepository users;

    @Autowired
    dev.infinia.store.domain.port.IdentityRepositories.NamespaceRepository namespaces;

    Http http() {
        return new Http(port);
    }

    private HttpHeaders jsonAuth(String token) {
        HttpHeaders headers = token == null ? new HttpHeaders() : Http.bearer(token);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> catalogItems(String type) {
        return (List<Map<String, Object>>) http()
                .getJson("/api/v1/catalog?type=" + type, Map.class, null).getBody()
                .get("items");
    }

    private String login(String email) {
        return AuthTestSupport.login(http(), null, email,
                dev.infinia.store.app.seed.SeedData.DEMO_PASSWORD);
    }

    @Test
    @SuppressWarnings("unchecked")
    void adminCanDelistAndRelistListings() {
        String admin = login("admin@infinia.local");
        UUID listingId = listings.findByCoordinate(dev.infinia.store.contract.coordinate
                        .InfiniaCoordinate.parse("infinia://plugin/official/markdown"))
                .orElseThrow().id;

        // Non-admins cannot touch curation.
        String user = login("user@infinia.local");
        assertEquals(403, http().exchangeJson(HttpMethod.POST,
                "/api/v1/admin/listings/" + listingId + "/visibility", jsonAuth(user),
                Map.of("visibility", "UNLISTED"), Map.class).getStatusCode().value());

        // Delist → gone from every catalog surface.
        ResponseEntity<Map> delisted = http().exchangeJson(HttpMethod.POST,
                "/api/v1/admin/listings/" + listingId + "/visibility", jsonAuth(admin),
                Map.of("visibility", "UNLISTED"), Map.class);
        assertEquals(200, delisted.getStatusCode().value());
        assertEquals("UNLISTED", delisted.getBody().get("visibility"));

        List<Map<String, Object>> after = catalogItems("PLUGIN");
        assertTrue(after.stream().noneMatch(i ->
                        "infinia://plugin/official/markdown"
                                .equals(i.get("coordinate"))),
                "delisted listing disappears from the catalog");

        // Relist → visible again.
        assertEquals(200, http().exchangeJson(HttpMethod.POST,
                "/api/v1/admin/listings/" + listingId + "/visibility", jsonAuth(admin),
                Map.of("visibility", "PUBLIC"), Map.class).getStatusCode().value());
        after = catalogItems("PLUGIN");
        assertTrue(after.stream().anyMatch(i ->
                "infinia://plugin/official/markdown".equals(i.get("coordinate"))));

        // Both actions are in the audit trail.
        ResponseEntity<List> audit = http().getJson("/api/v1/admin/audit-events",
                List.class, Http.bearer(admin));
        assertTrue(audit.getBody().stream().anyMatch(e ->
                "listing.visibility".equals(((Map<?, ?>) e).get("action"))));
    }

    @Test
    @SuppressWarnings("unchecked")
    void adminCanFeatureListingsAndCatalogFilters() {
        String admin = login("admin@infinia.local");
        UUID listingId = listings.findByCoordinate(dev.infinia.store.contract.coordinate
                        .InfiniaCoordinate.parse("infinia://plugin/official/email"))
                .orElseThrow().id;

        ResponseEntity<Map> featured = http().exchangeJson(HttpMethod.POST,
                "/api/v1/admin/listings/" + listingId + "/featured", jsonAuth(admin),
                Map.of("featured", true), Map.class);
        assertEquals(200, featured.getStatusCode().value());
        assertEquals(true, featured.getBody().get("featured"));

        // Featured shelf returns exactly the featured listing; the plain catalog
        // carries the flag too.
        ResponseEntity<Map> shelf = http().getJson("/api/v1/catalog?featured=true",
                Map.class, null);
        List<Map<String, Object>> shelfItems =
                (List<Map<String, Object>>) shelf.getBody().get("items");
        assertEquals(1, shelfItems.size());
        assertEquals("infinia://plugin/official/email", shelfItems.get(0).get("coordinate"));
        assertEquals(true, shelfItems.get(0).get("featured"));

        // Admin console sees every listing with curation state.
        ResponseEntity<Map> console = http().getJson("/api/v1/admin/listings",
                Map.class, Http.bearer(admin));
        List<Map<String, Object>> consoleItems =
                (List<Map<String, Object>>) console.getBody().get("items");
        assertTrue(consoleItems.stream().anyMatch(l ->
                "infinia://plugin/official/email".equals(l.get("coordinate"))
                        && Boolean.TRUE.equals(l.get("featured"))));

        // Unfeature cleans the shelf.
        http().exchangeJson(HttpMethod.POST,
                "/api/v1/admin/listings/" + listingId + "/featured", jsonAuth(admin),
                Map.of("featured", false), Map.class);
        assertTrue(((List<?>) http().getJson("/api/v1/catalog?featured=true", Map.class,
                null).getBody().get("items")).isEmpty());
    }

    /**
     * Regression for the frozen admin console: the listing view is
     * cursor-paged with the text search pushed into SQL, so the response (and
     * its statement count) no longer scales with the whole catalog. The old
     * shape — one flat array, five statements per listing — turned a catalog
     * of thousands into a multi-second, CPU-saturating page load.
     */
    @Test
    @SuppressWarnings("unchecked")
    void consoleListingsAreCursorPagedWithSqlSearch() {
        String admin = login("admin@infinia.local");

        // A batch larger than any single page under a dedicated namespace.
        String marker = "console-paging-probe";
        java.time.Instant now = java.time.Instant.now();
        java.util.UUID publisher = users.findByEmailNormalized("publisher@infinia.local")
                .orElseThrow().id;
        dev.infinia.store.domain.model.Namespace ns =
                new dev.infinia.store.domain.model.Namespace(
                        dev.infinia.store.domain.service.UuidV7.generate(),
                        marker + "-ns", publisher, null, false, now);
        namespaces.save(ns);
        for (int i = 0; i < 12; i++) {
            dev.infinia.store.domain.model.Listing l =
                    new dev.infinia.store.domain.model.Listing();
            l.id = dev.infinia.store.domain.service.UuidV7.generate();
            l.namespaceId = ns.id();
            l.namespace = ns.name();
            l.slug = marker + "-" + i;
            l.type = dev.infinia.store.contract.type.ListingType.PLUGIN;
            l.visibility = dev.infinia.store.contract.type.ListingVisibility.PUBLIC;
            l.status = "ACTIVE";
            l.category = "Productivity";
            l.tags = new java.util.ArrayList<>();
            l.screenshots = new java.util.ArrayList<>();
            l.defaultChannel = dev.infinia.store.contract.type.Channel.STABLE;
            l.publisherUserId = publisher;
            l.downloads = i;
            l.createdAt = now;
            l.updatedAt = now.plusSeconds(i);
            l.localizations = new java.util.ArrayList<>(java.util.List.of(
                    new dev.infinia.store.domain.model.Listing.Localization(
                            "en", "Console Paging Probe " + i, "paged console fixture", null, null)));
            listings.save(l);
        }

        // Pages walk without duplicates until the cursor runs out.
        java.util.Set<String> seen = new java.util.HashSet<>();
        String cursor = null;
        int pages = 0;
        while (true) {
            String path = "/api/v1/admin/listings?limit=5"
                    + (cursor == null ? "" : "&after=" + cursor);
            ResponseEntity<Map> page = http().getJson(path, Map.class, Http.bearer(admin));
            List<Map<String, Object>> items = (List<Map<String, Object>>) page.getBody().get("items");
            assertTrue(items.size() <= 5);
            items.forEach(item -> assertTrue(seen.add((String) item.get("listingId")),
                    "cursor walk returned a listing twice"));
            pages++;
            cursor = (String) page.getBody().get("nextCursor");
            if (cursor == null) {
                break;
            }
        }
        assertTrue(pages >= 3, "12+ listings over pages of 5 need several pages");
        long probeCount = seen.stream()
                .filter(id -> listings.findById(java.util.UUID.fromString(id))
                        .map(l -> l.namespace.equals(ns.name())).orElse(false))
                .count();
        assertEquals(12, probeCount, "the walk must surface every probe listing exactly once");

        // SQL-side text search narrows to the probes by i18n name...
        ResponseEntity<Map> byName = http().getJson(
                "/api/v1/admin/listings?query=" + marker, Map.class, Http.bearer(admin));
        assertEquals(12, ((Number) byName.getBody().get("totalEstimate")).longValue());
        List<Map<String, Object>> nameItems =
                (List<Map<String, Object>>) byName.getBody().get("items");
        assertTrue(nameItems.stream().allMatch(i ->
                ((String) i.get("name")).startsWith("Console Paging Probe")));

        // ...and by coordinate part (namespace/slug) as the old client filter did.
        ResponseEntity<Map> bySlug = http().getJson(
                "/api/v1/admin/listings?query=" + marker + "-ns&limit=200",
                Map.class, Http.bearer(admin));
        assertEquals(12, ((Number) bySlug.getBody().get("totalEstimate")).longValue());

        // A garbage cursor yields an empty page instead of an error.
        ResponseEntity<Map> garbage = http().getJson(
                "/api/v1/admin/listings?after=not-a-uuid", Map.class, Http.bearer(admin));
        assertTrue(((List<?>) garbage.getBody().get("items")).isEmpty());
    }
}
