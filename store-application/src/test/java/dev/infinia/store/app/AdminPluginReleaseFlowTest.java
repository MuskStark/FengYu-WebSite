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

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Official FengYu plugin (.fyp) releases through the intranet admin path
 * (AdminPluginReleaseController): the store is the only distribution channel
 * for official plugins, so the admin upload publishes instantly — like the
 * host-app flow — and the FengYu compat catalog (/api/v1/compat/fengyu/catalog)
 * serves it to the host's plugin updater immediately.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class AdminPluginReleaseFlowTest {

    @LocalServerPort
    int port;

    @Autowired
    dev.infinia.store.domain.port.ListingRepository listings;

    Http http() {
        return new Http(port);
    }

    private HttpHeaders jsonAuth(String token) {
        HttpHeaders headers = Http.bearer(token);
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    /**
     * The full official-plugin publish pipeline: the platform admin starts an
     * upload (first use creates the fan.summer namespace + listing), PUTs the
     * .fyp through the ticketed pipeline, publishes instantly, and the compat
     * catalog immediately serves the entry with the artifact digest the host
     * requires. Deleting the release removes it from the catalog.
     */
    @Test
    @SuppressWarnings("unchecked")
    void adminPublishesOfficialPluginAndCatalogServesItImmediately() throws Exception {
        String adminToken = AuthTestSupport.login(http(), null, "admin@infinia.local",
                dev.infinia.store.app.seed.SeedData.DEMO_PASSWORD);
        String userToken = AuthTestSupport.login(http(), null, "user@infinia.local",
                dev.infinia.store.app.seed.SeedData.DEMO_PASSWORD);

        byte[] fyp = "official-fan.summer.markdown-9.9.9.fyp-bytes".getBytes(StandardCharsets.UTF_8);
        Map<String, Object> startBody = Map.of(
                "pluginId", "fan.summer.markdown",
                "version", "9.9.9",
                "filename", "fan.summer.markdown-9.9.9.fyp",
                "size", fyp.length,
                "name", "Markdown Editor",
                "summary", "Split-pane Markdown editor",
                "category", "text",
                "changelog", "test release",
                "requiresHost", ">=4.0.0 <5.0.0",
                "permissions", List.of("files.read", "files.write"));

        // A plain user must not reach the admin surface.
        assertEquals(403, http().exchangeJson(HttpMethod.POST, "/api/v1/admin/plugin-releases",
                jsonAuth(userToken), startBody, Map.class).getStatusCode().value());

        // Only the official id range is accepted.
        assertEquals(400, http().exchangeJson(HttpMethod.POST, "/api/v1/admin/plugin-releases",
                jsonAuth(adminToken), Map.of("pluginId", "evil.markdown",
                        "version", "1.0.0", "filename", "evil-1.0.0.fyp", "size", 1),
                Map.class).getStatusCode().value());

        ResponseEntity<Map> start = http().exchangeJson(HttpMethod.POST,
                "/api/v1/admin/plugin-releases", jsonAuth(adminToken), startBody, Map.class);
        assertEquals(201, start.getStatusCode().value(), String.valueOf(start.getBody()));
        Map<String, Object> started = start.getBody();
        // A .fyp is a host-platform-independent PACKAGE: universal routing.
        assertEquals("fan.summer.markdown", started.get("pluginId"));
        assertEquals("PACKAGE", started.get("kind"));
        assertEquals("universal", started.get("platform"));
        assertEquals("universal", started.get("arch"));
        String releaseId = (String) started.get("releaseId");

        // First use reserved the namespace and created the conventional listing.
        assertNotNull(listings.findByCoordinate(dev.infinia.store.contract.coordinate
                        .InfiniaCoordinate.parse("infinia://plugin/fan.summer/markdown"))
                .orElse(null), "fan.summer.markdown listing created on first use");

        // Anonymous ticketed PUT carries the package bytes.
        HttpHeaders putHeaders = new HttpHeaders();
        putHeaders.setContentType(MediaType.APPLICATION_OCTET_STREAM);
        assertEquals(204, http().exchange(HttpMethod.PUT, (String) started.get("uploadUrl"),
                putHeaders, fyp).getStatusCode().value());

        // Publish immediately — the platform admin is the review decision.
        ResponseEntity<Map> published = http().exchangeJson(HttpMethod.POST,
                "/api/v1/admin/plugin-releases/" + releaseId + "/publish", jsonAuth(adminToken),
                null, Map.class);
        assertEquals(200, published.getStatusCode().value());
        assertEquals("PUBLISHED", published.getBody().get("status"));
        List<Map<String, Object>> artifacts = (List<Map<String, Object>>) published.getBody()
                .get("artifacts");
        assertEquals(1, artifacts.size());
        assertTrue(((String) artifacts.get(0).get("sha256")).matches("[0-9a-f]{64}"));

        // The compat catalog immediately serves the entry the host updates from.
        ResponseEntity<List> catalog = http().getJson("/api/v1/compat/fengyu/catalog",
                List.class, null);
        Map<String, Object> entry = ((List<Map<String, Object>>) catalog.getBody()).stream()
                .filter(e -> "fan.summer.markdown".equals(e.get("id")))
                .findFirst().orElseThrow(() -> new AssertionError(
                        "catalog entry missing: " + catalog.getBody()));
        assertEquals("9.9.9", entry.get("version"));
        assertEquals(artifacts.get(0).get("sha256"), entry.get("sha256"),
                "catalog digest matches the published artifact");
        assertEquals(List.of("files.read", "files.write"), entry.get("permissions"));
        // The ticketed download URL serves the uploaded bytes.
        String downloadUrl = (String) entry.get("downloadUrl");
        ResponseEntity<byte[]> served = http().getBytes(
                downloadUrl.substring(downloadUrl.indexOf("/api/v1/blobs/")));
        assertEquals(200, served.getStatusCode().value());
        assertArrayEquals(fyp, served.getBody());

        // The admin list shows the release; deleting it removes it from the catalog.
        List<Map<String, Object>> listed = http().getJson(
                        "/api/v1/admin/plugin-releases?pluginId=fan.summer.markdown", List.class,
                        Http.bearer(adminToken)).getBody();
        assertTrue(listed.stream().anyMatch(r -> releaseId.equals(r.get("releaseId"))));
        assertEquals(204, http().exchange(HttpMethod.DELETE,
                "/api/v1/admin/plugin-releases/" + releaseId, jsonAuth(adminToken),
                null).getStatusCode().value());
        ResponseEntity<List> after = http().getJson("/api/v1/compat/fengyu/catalog",
                List.class, null);
        assertTrue(((List<Map<String, Object>>) after.getBody()).stream()
                .noneMatch(e -> "fan.summer.markdown".equals(e.get("id"))),
                "deleted release leaves the catalog");
    }
}
