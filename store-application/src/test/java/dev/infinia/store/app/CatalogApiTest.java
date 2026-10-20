package dev.infinia.store.app;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Anonymous catalog access (design §16 Phase 1 acceptance: browsing works without
 * an account and all five artifact classes are visible).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class CatalogApiTest {

    @org.springframework.beans.factory.annotation.Autowired
    org.springframework.context.ApplicationContext context;

    @org.springframework.boot.test.web.server.LocalServerPort
    int port;

    Http http() {
        return new Http(port);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> items(ResponseEntity<String> response) {
        try {
            Map<String, Object> page = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(response.getBody(), Map.class);
            return (List<Map<String, Object>>) page.get("items");
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void anonymousBrowseReturnsAllFiveTypes() {
        ResponseEntity<String> response = http().getJson("/api/v1/catalog?limit=50",
                String.class, null);
        assertEquals(200, response.getStatusCode().value());
        assertNotNull(response.getHeaders().getETag());
        List<Map<String, Object>> page = items(response);
        assertTrue(page.size() >= 6, "expected seeded listings, got " + page.size());
        List<String> types = page.stream().map(i -> (String) i.get("type")).distinct().toList();
        assertTrue(types.containsAll(List.of("APP", "PLUGIN", "SKILL", "MCP", "FLOW")),
                "all five types must be present, got: " + types);
    }

    @Test
    void totalEstimateCountsBeyondTheCurrentPage() throws Exception {
        ResponseEntity<String> response = http().getJson("/api/v1/catalog?limit=2",
                String.class, null);
        Map<String, Object> body = new com.fasterxml.jackson.databind.ObjectMapper()
                .readValue(response.getBody(), Map.class);
        assertEquals(2, ((List<?>) body.get("items")).size());
        assertTrue(((Number) body.get("totalEstimate")).longValue() > 2,
                "totalEstimate must describe the catalog, not the current page: " + body);
        assertNotNull(body.get("nextCursor"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void cursorWalkCoversTheCatalogWithoutRepeats() throws Exception {
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        java.util.Set<Object> seen = new java.util.HashSet<>();
        String cursor = null;
        long totalEstimate = -1;
        int pages = 0;
        while (pages < 50) {
            String url = "/api/v1/catalog?limit=2" + (cursor == null ? "" : "&cursor=" + cursor);
            ResponseEntity<String> response = http().getJson(url, String.class, null);
            assertEquals(200, response.getStatusCode().value());
            Map<String, Object> body = mapper.readValue(response.getBody(), Map.class);
            List<Map<String, Object>> items = (List<Map<String, Object>>) body.get("items");
            assertTrue(items.size() <= 2, "a page must honor the limit, got " + items.size());
            for (Map<String, Object> item : items) {
                assertTrue(seen.add(item.get("coordinate")),
                        "cursor walk repeated " + item.get("coordinate"));
            }
            totalEstimate = ((Number) body.get("totalEstimate")).longValue();
            cursor = (String) body.get("nextCursor");
            pages++;
            if (cursor == null || items.isEmpty()) {
                break;
            }
        }
        assertTrue(pages > 1, "seeded catalog must span more than one limit=2 page");
        assertTrue(seen.size() <= totalEstimate,
                "walked " + seen.size() + " items but totalEstimate said " + totalEstimate);
    }

    @Test
    void garbageCursorYieldsAnEmptyPageInsteadOfAnError() throws Exception {
        ResponseEntity<String> response = http().getJson(
                "/api/v1/catalog?limit=2&cursor=not-a-uuid", String.class, null);
        assertEquals(200, response.getStatusCode().value());
        Map<String, Object> body = new com.fasterxml.jackson.databind.ObjectMapper()
                .readValue(response.getBody(), Map.class);
        assertTrue(((List<?>) body.get("items")).isEmpty());
        assertNull(body.get("nextCursor"));
    }

    @Test
    void filtersByTypeAndSearch() {
        ResponseEntity<String> plugins = http().getJson("/api/v1/catalog?type=PLUGIN",
                String.class, null);
        assertTrue(items(plugins).size() >= 2);
        assertTrue(items(plugins).stream().allMatch(i -> "PLUGIN".equals(i.get("type"))));

        ResponseEntity<String> search = http().getJson("/api/v1/catalog?query=markdown",
                String.class, null);
        List<Map<String, Object>> found = items(search);
        assertEquals(1, found.size());
        assertEquals("infinia://plugin/official/markdown", found.get(0).get("coordinate"));
        assertEquals("2.4.0", found.get(0).get("latestVersion"));
    }

    @Test
    void compatibilityFilterHonorsHostVersion() {
        // markdown requires >=4.0.0 <5.0.0 — an incompatible host must not see it.
        ResponseEntity<String> compatible = http().getJson(
                "/api/v1/catalog?type=PLUGIN&hostVersion=4.2.0", String.class, null);
        assertTrue(items(compatible).stream()
                .anyMatch(i -> "markdown".equals(i.get("slug"))));

        ResponseEntity<String> incompatible = http().getJson(
                "/api/v1/catalog?type=PLUGIN&hostVersion=5.0.0", String.class, null);
        assertTrue(items(incompatible).stream()
                .noneMatch(i -> "markdown".equals(i.get("slug"))));
    }

    @Test
    void listingDetailContainsSignedRelease() {
        ResponseEntity<Map> detail = http().getJson("/api/v1/listings/official/markdown",
                Map.class, null);
        assertEquals(200, detail.getStatusCode().value());
        Map body = detail.getBody();
        assertNotNull(body);
        assertEquals("PLUGIN", body.get("type"));
        List<Map<String, Object>> releases = (List<Map<String, Object>>) body.get("releases");
        assertEquals(1, releases.size());
        Map<String, Object> release = releases.get(0);
        assertEquals("PUBLISHED", release.get("status"));
        List<Map<String, Object>> artifacts =
                (List<Map<String, Object>>) release.get("artifacts");
        assertEquals(1, artifacts.size());
        assertNotNull(artifacts.get(0).get("keyId"), "platform signature key must be attached");
        assertEquals(64, ((String) artifacts.get(0).get("sha256")).length());
        // Localized content exists in both English and Chinese.
        List<Map<String, Object>> localizations =
                (List<Map<String, Object>>) body.get("localizations");
        assertTrue(localizations.stream().anyMatch(l -> "zh-CN".equals(l.get("locale"))));
    }

    @Test
    void unknownListingReturnsProblemJson() {
        ResponseEntity<Map> response = http().getJson("/api/v1/listings/official/nope",
                Map.class, null);
        assertEquals(404, response.getStatusCode().value());
        assertEquals("application/problem+json",
                response.getHeaders().getContentType().toString());
        assertEquals("listing_not_found", response.getBody().get("code"));
        assertNotNull(response.getBody().get("traceId"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void badEnumParametersReturnFriendly400InsteadOf500() {
        // Audit 3.6: ListingType.valueOf / ListingSort.valueOf turned bad query
        // input into raw enum errors; the parse variants answer an actionable
        // validation problem listing the accepted values.
        ResponseEntity<Map> badType = http().getJson("/api/v1/catalog?type=bogus",
                Map.class, null);
        assertEquals(400, badType.getStatusCode().value());
        assertEquals("validation_failed", badType.getBody().get("code"));
        assertTrue(String.valueOf(badType.getBody().get("detail")).contains("app, plugin"),
                "detail must list the accepted types: " + badType.getBody());

        ResponseEntity<Map> badSort = http().getJson("/api/v1/catalog?sort=random",
                Map.class, null);
        assertEquals(400, badSort.getStatusCode().value());
        assertEquals("validation_failed", badSort.getBody().get("code"));
        assertTrue(String.valueOf(badSort.getBody().get("detail")).contains("relevance"),
                "detail must list the accepted sorts: " + badSort.getBody());

        // Case-insensitive parse still works for valid input.
        assertEquals(200, http().getJson("/api/v1/catalog?type=plugin&sort=downloads",
                String.class, null).getStatusCode().value());
    }

    @Test
    void resolvesFlowWithDependencyClosure() {
        String body = """
                {
                  "coordinate": "infinia://flow/summer/mail-digest",
                  "client": {
                    "hostVersion": "4.0.1",
                    "os": "macos",
                    "arch": "arm64",
                    "channel": "stable",
                    "installed": []
                  }
                }
                """;
        ResponseEntity<Map> response = http().exchangeJson(org.springframework.http.HttpMethod.POST,
                "/api/v1/resolutions", jsonHeaders(), body, Map.class);
        assertEquals(200, response.getStatusCode().value());
        Map body2 = response.getBody();
        assertNotNull(body2);
        assertTrue((Boolean) body2.get("resolvable"), "seeded flow must resolve, got: " + body2);
        List<Map<String, Object>> plan = (List<Map<String, Object>>) body2.get("plan");
        assertTrue(plan.size() >= 3, "flow + email plugin + calendar mcp expected");
        assertTrue(plan.stream().anyMatch(p -> p.get("coordinate")
                .toString().startsWith("infinia://plugin/official/email@2.0.1")),
                "dependency picks the minimal satisfying version");
    }

    @Test
    void resolutionReportsMissingDependencies() {
        String body = """
                {
                  "coordinate": "infinia://flow/summer/mail-digest",
                  "range": ">=99.0.0",
                  "client": {"hostVersion": "4.0.1", "os": "macos", "arch": "arm64"}
                }
                """;
        ResponseEntity<Map> response = http().exchangeJson(org.springframework.http.HttpMethod.POST,
                "/api/v1/resolutions", jsonHeaders(), body, Map.class);
        assertEquals(200, response.getStatusCode().value());
        assertFalse((Boolean) response.getBody().get("resolvable"));
    }

    private static org.springframework.http.HttpHeaders jsonHeaders() {
        var headers = new org.springframework.http.HttpHeaders();
        headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
        return headers;
    }
}
