package dev.infinia.store.app.seed;

import dev.infinia.store.app.service.CatalogService;
import dev.infinia.store.app.service.PlatformSigningService;
import dev.infinia.store.contract.semver.SemVer;
import dev.infinia.store.contract.type.Arch;
import dev.infinia.store.contract.type.ArtifactKind;
import dev.infinia.store.contract.type.BeeLevel;
import dev.infinia.store.contract.type.Channel;
import dev.infinia.store.contract.type.ListingType;
import dev.infinia.store.contract.type.Platform;
import dev.infinia.store.contract.type.ReleaseStatus;
import dev.infinia.store.contract.type.UserRole;
import dev.infinia.store.domain.model.Credential;
import dev.infinia.store.domain.model.Listing;
import dev.infinia.store.domain.model.Namespace;
import dev.infinia.store.domain.model.Release;
import dev.infinia.store.domain.model.StoreUser;
import dev.infinia.store.domain.port.BlobStorage;
import dev.infinia.store.domain.port.IdentityRepositories;
import dev.infinia.store.domain.port.ListingRepository;
import dev.infinia.store.domain.port.PasswordHasher;
import dev.infinia.store.domain.port.ReleaseRepository;
import dev.infinia.store.domain.service.UuidV7;
import dev.infinia.store.scanner.Ed25519Signer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Demo seed data (design §16 Phase 1 acceptance: all five classes visible in the
 * catalog). Enabled with store.seed.enabled=true (local/dev/test profiles).
 */
@Component
public class SeedData {

    public static final String DEMO_PASSWORD = "Password123!";
    public static final String ADMIN_EMAIL = "admin@infinia.local";
    public static final String REVIEWER_EMAIL = "reviewer@infinia.local";
    public static final String PUBLISHER_EMAIL = "publisher@infinia.local";
    public static final String CI_EMAIL = "ci@infinia.local";
    public static final String USER_EMAIL = "user@infinia.local";

    private static final Logger log = LoggerFactory.getLogger(SeedData.class);

    private final IdentityRepositories.UserRepository users;
    private final IdentityRepositories.CredentialRepository credentials;
    private final IdentityRepositories.NamespaceRepository namespaces;
    private final ListingRepository listings;
    private final ReleaseRepository releases;
    private final PasswordHasher hasher;
    private final BlobStorage blobs;
    private final CatalogService catalog;
    private final PlatformSigningService signing;
    private final boolean enabled;
    /** Demo listings/releases; accounts always seed (tests depend on the catalog). */
    private final boolean demoContent;
    private final Environment environment;

    public SeedData(IdentityRepositories.UserRepository users,
            IdentityRepositories.CredentialRepository credentials,
            IdentityRepositories.NamespaceRepository namespaces,
            ListingRepository listings, ReleaseRepository releases, PasswordHasher hasher,
            BlobStorage blobs, CatalogService catalog, PlatformSigningService signing,
            Environment environment,
            @Value("${store.seed.enabled:false}") boolean enabled,
            @Value("${store.seed.demo-content:false}") boolean demoContent) {
        this.users = users;
        this.credentials = credentials;
        this.namespaces = namespaces;
        this.listings = listings;
        this.releases = releases;
        this.hasher = hasher;
        this.blobs = blobs;
        this.catalog = catalog;
        this.signing = signing;
        this.environment = environment;
        this.enabled = enabled;
        this.demoContent = demoContent;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Order(Ordered.LOWEST_PRECEDENCE - 1)
    @Transactional
    public void seed() {
        if (!enabled) {
            return;
        }
        // Demo credentials are PUBLIC knowledge (README/tests). Seeding outside a
        // development profile would hand the admin account to anyone who read the
        // repo — refuse to run instead (audit P1-8).
        if (!environment.acceptsProfiles(Profiles.of("local", "dev", "test"))) {
            throw new IllegalStateException("store.seed.enabled=true is only allowed with"
                    + " the local/dev/test profiles — disable seeding or use a real"
                    + " admin bootstrap in production-like deployments");
        }
        if (users.findByEmailNormalized(ADMIN_EMAIL).isPresent()) {
            ensureDemoAccounts();
            return;
        }
        Instant now = Instant.now();
        StoreUser admin = user(ADMIN_EMAIL, "Store Admin", Set.of(UserRole.USER,
                UserRole.PLATFORM_ADMIN), now);
        user(REVIEWER_EMAIL, "Demo Reviewer", Set.of(UserRole.USER, UserRole.REVIEWER), now);
        StoreUser publisher = user(PUBLISHER_EMAIL, "Infinia Official",
                Set.of(UserRole.USER, UserRole.PUBLISHER), BeeLevel.GUARD.level, now);
        user(CI_EMAIL, "CI Service Account", Set.of(UserRole.USER, UserRole.PUBLISHER,
                UserRole.REVIEWER), now);
        user(USER_EMAIL, "Demo User", Set.of(UserRole.USER), BeeLevel.WORKER.level, now);

        if (!demoContent) {
            // Accounts only — local/dev runs stay clean for real content
            // (tests opt into isolated catalog fixtures explicitly).
            log.info("Seeded store accounts (demo content disabled)");
            return;
        }

        Namespace official = namespace("official", publisher.id, now);
        namespace("summer", publisher.id, now);

        try {
            seedApp(publisher, now);
            seedPlugin(publisher, now);
            seedEmailPlugin(publisher, now);
            seedSkill(publisher, now);
            seedMcp(publisher, now);
            seedFlow(publisher, now);
        } catch (IOException e) {
            throw new IllegalStateException("Seeding failed", e);
        }
        log.info("Seeded demo store data (users: {}, listings: 6)", 5);
    }

    private void seedApp(StoreUser publisher, Instant now) throws IOException {
        Listing listing = listing(publisher, ListingType.APP, "official", "fengyu-host",
                "Infinia Host", "The local-first FengYu host application.",
                "Productivity", List.of("host", "official"), Channel.STABLE, now);
        // Mirrors the FengYu release matrix: installed + portable distributions
        // for every platform, plus the jre / web / jar build variants.
        publish(listing, "4.1.0", Channel.STABLE, null, 100, now,
                installerArtifact(listing, "4.1.0", Platform.WINDOWS, Arch.X64, "lite",
                        "Infinia-4.1.0-win-x64-setup.exe", now),
                portableArtifact(listing, "4.1.0", Platform.WINDOWS, Arch.X64, "lite",
                        "Infinia-4.1.0-win-x64-portable.zip", now),
                installerArtifact(listing, "4.1.0", Platform.MACOS, Arch.ARM64, "lite",
                        "Infinia-4.1.0-mac-arm64.dmg", now),
                installerArtifact(listing, "4.1.0", Platform.MACOS, Arch.ARM64, "jre",
                        "Infinia-JRE-4.1.0-mac-arm64.dmg", now),
                installerArtifact(listing, "4.1.0", Platform.LINUX, Arch.X64, "lite",
                        "Infinia-4.1.0-linux-x64.deb", now),
                portableArtifact(listing, "4.1.0", Platform.LINUX, Arch.X64, "lite",
                        "Infinia-4.1.0-linux-x64.AppImage", now),
                portableArtifact(listing, "4.1.0", Platform.UNIVERSAL, Arch.UNIVERSAL, "web",
                        "Infinia-4.1.0-web.zip", now),
                portableArtifact(listing, "4.1.0", Platform.UNIVERSAL, Arch.UNIVERSAL, "jar",
                        "Infinia.jar", now));
        publish(listing, "4.2.0-beta.1", Channel.BETA, null, 25, now,
                installerArtifact(listing, "4.2.0-beta.1", Platform.MACOS, Arch.ARM64, "lite",
                        "Infinia-4.2.0-beta.1-mac-arm64.dmg", now));
    }

    private void seedPlugin(StoreUser publisher, Instant now) throws IOException {
        Listing listing = listing(publisher, ListingType.PLUGIN, "official", "markdown",
                "Markdown Tools", "Render and convert Markdown inside FengYu.",
                "Productivity", List.of("markdown", "docs"), Channel.STABLE, now);
        byte[] fyp = zipOf(new String[][] {
                {"manifest.json", """
                        {"schemaVersion":2,"id":"official.markdown","name":"Markdown Tools",
                         "description":"Render and convert Markdown inside FengYu.",
                         "author":"official","icon":"language-markdown","category":"Productivity",
                         "version":"2.4.0","ui":{"entry":"index.js"},
                         "permissions":["files.read"],
                         "engines":{"fengyu":">=4.0.0 <5.0.0"}}
                        """},
                {"index.js", "export function render(md){ return md; }"},
                {"README.md", "# Markdown Tools\nRenders Markdown."}});
        Release markdown = draft(listing, "2.4.0", Channel.STABLE, ">=4.0.0 <5.0.0", now);
        markdown.rolloutPercent = 100;
        markdown.artifacts = new ArrayList<>(List.of(
                packageArtifact(listing, "2.4.0", "markdown-2.4.0.fyp", fyp, now)));
        markdown.permissions = List.of(new Release.PermissionDecl("files.read",
                "fs:~/.fengyu/plugins/markdown", true, "Reads markdown documents"));
        finish(markdown, listing, now);
    }

    private void seedEmailPlugin(StoreUser publisher, Instant now) throws IOException {
        Listing listing = listing(publisher, ListingType.PLUGIN, "official", "email",
                "Email Connector", "SMTP/IMAP connector used by mail flows.",
                "Communication", List.of("email"), Channel.STABLE, now);
        byte[] fyp = zipOf(new String[][] {
                {"manifest.json", """
                        {"schemaVersion":2,"id":"official.email","name":"Email Connector",
                         "description":"SMTP/IMAP connector used by mail flows.",
                         "author":"official","icon":"email-outline","category":"Communication",
                         "version":"2.0.1","ui":{"entry":"index.js"},
                         "permissions":["network","network.email"],
                         "engines":{"fengyu":">=4.0.0 <5.0.0"}}
                        """},
                {"index.js", "export function send(mail){ return true; }"}});
        Release email = draft(listing, "2.0.1", Channel.STABLE, ">=4.0.0 <5.0.0", now);
        email.rolloutPercent = 100;
        email.artifacts = new ArrayList<>(List.of(
                packageArtifact(listing, "2.0.1", "email-2.0.1.fyp", fyp, now)));
        email.permissions = List.of(new Release.PermissionDecl("network",
                "network:smtp+imap", true, "Sends and reads mail"),
                new Release.PermissionDecl("network.email",
                        "network:host:smtp.local", true, "Mail transport"));
        finish(email, listing, now);
    }

    private void seedSkill(StoreUser publisher, Instant now) throws IOException {
        Listing listing = listing(publisher, ListingType.SKILL, "official", "pdf-tools",
                "PDF Toolkit", "Extract, merge and summarize PDF documents.",
                "Documents", List.of("pdf", "documents"), Channel.STABLE, now);
        byte[] fys = zipOf(new String[][] {
                {"manifest.json", """
                        {"schemaVersion":1,"id":"official.pdf-tools","name":"PDF Toolkit",
                         "description":"Extract, merge and summarize PDF documents",
                         "version":"1.3.0","author":"official","icon":"file-pdf-box",
                         "homepage":null,"official":false}
                        """},
                {"SKILL.md", """
                ---
                name: pdf-tools
                description: Extract, merge and summarize PDF documents
                ---
                # PDF Toolkit
                Use this skill when the user asks to work with PDF files.
                """}});
        publish(listing, "1.3.0", Channel.STABLE, ">=4.0.0 <5.0.0", 100, now,
                packageArtifact(listing, "1.3.0", "pdf-tools-1.3.0.fys", fys, now));
    }

    private void seedMcp(StoreUser publisher, Instant now) {
        Listing listing = listing(publisher, ListingType.MCP, "official", "calendar",
                "Calendar MCP", "Reviewed Calendar MCP template — installs disabled.",
                "Productivity", List.of("mcp", "calendar"), Channel.STABLE, now);
        byte[] template = """
                {
                  "schemaVersion": 1,
                  "id": "official.calendar",
                  "name": "Calendar MCP",
                  "transport": "STREAMABLE_HTTP",
                  "urlTemplate": "https://mcp.infinia.dev/mcp",
                  "requiredSecrets": [{"name": "authorization", "target": "header", "sensitive": true}],
                  "defaultEnabled": false,
                  "toolPolicy": {"enabledByDefault": false},
                  "networkHosts": ["mcp.infinia.dev"]
                }
                """.getBytes(StandardCharsets.UTF_8);
        Release release = draft(listing, "1.0.0", Channel.STABLE, ">=4.0.0 <5.0.0", now);
        release.permissions = List.of(new Release.PermissionDecl("mcp.connect",
                "network:host:mcp.infinia.dev", true, "Connect to the Calendar MCP service"));
        attachPackage(release, Platform.UNIVERSAL, Arch.UNIVERSAL, "calendar-1.0.0.mcp.json",
                template, now);
        finish(release, listing, now);
    }

    private void seedFlow(StoreUser publisher, Instant now) throws IOException {
        Listing listing = listing(publisher, ListingType.FLOW, "summer", "mail-digest",
                "Mail Digest", "Summarize your inbox into a morning digest.",
                "Automation", List.of("email", "digest"), Channel.STABLE, now);
        byte[] fyflow = zipOf(new String[][] {
                {"manifest.json", "{\"schemaVersion\":1,\"version\":\"1.2.0\",\"entry\":\"workflow.json\"}"},
                {"workflow.json", """
                        {"inputSchema":{"type":"object","properties":{"hours":{"type":"number"}}},
                         "plan":["fetch mail","summarize","write digest"],
                         "graph":{"nodes":[],"edges":[]}}
                        """},
                {"dependencies.lock.json", """
                        {"plugins":[{"coordinate":"infinia://plugin/official/email","version":"2.0.1"}]}
                        """},
                {"README.md", "# Mail Digest\nBuilds a daily digest."}});
        Release release = draft(listing, "1.2.0", Channel.STABLE, ">=4.0.0-beta.5 <5.0.0", now);
        release.dependencies = List.of(
                new Release.DependencyDecl("infinia://plugin/official/email",
                        ">=2.0.0 <3.0.0", false),
                new Release.DependencyDecl("infinia://mcp/official/calendar", "^1.0.0", true));
        release.permissions = List.of(new Release.PermissionDecl("plugin.invoke.email",
                "plugin:official.email", true, "Sends the digest email"));
        attachPackage(release, Platform.UNIVERSAL, Arch.UNIVERSAL, "mail-digest-1.2.0.fyflow",
                fyflow, now);
        finish(release, listing, now);
    }

    // ---- helpers ----

    /**
     * Creates any of the five demo accounts that are still missing — and NEVER
     * touches an existing credential (audit P1-8): the previous "repair" behavior
     * reset the admin's changed password back to the publicly documented demo
     * value on every boot, silently surrendering the admin account whenever seed
     * was enabled on a real deployment.
     */
    private void ensureDemoAccounts() {
        Instant now = Instant.now();
        if (users.findByEmailNormalized(ADMIN_EMAIL).isEmpty()) {
            user(ADMIN_EMAIL, "Store Admin", Set.of(UserRole.USER, UserRole.PLATFORM_ADMIN),
                    now);
        }
        if (users.findByEmailNormalized(REVIEWER_EMAIL).isEmpty()) {
            user(REVIEWER_EMAIL, "Demo Reviewer", Set.of(UserRole.USER, UserRole.REVIEWER),
                    now);
        }
        if (users.findByEmailNormalized(PUBLISHER_EMAIL).isEmpty()) {
            user(PUBLISHER_EMAIL, "Infinia Official",
                    Set.of(UserRole.USER, UserRole.PUBLISHER), BeeLevel.GUARD.level, now);
        }
        if (users.findByEmailNormalized(CI_EMAIL).isEmpty()) {
            user(CI_EMAIL, "CI Service Account", Set.of(UserRole.USER, UserRole.PUBLISHER,
                    UserRole.REVIEWER), now);
        }
        if (users.findByEmailNormalized(USER_EMAIL).isEmpty()) {
            user(USER_EMAIL, "Demo User", Set.of(UserRole.USER), BeeLevel.WORKER.level, now);
        }
    }

    private StoreUser user(String email, String name, Set<UserRole> roles, Instant now) {
        return user(email, name, roles, BeeLevel.LARVA.level, now);
    }

    private StoreUser user(String email, String name, Set<UserRole> roles, int beeLevel,
            Instant now) {
        StoreUser user = new StoreUser(UuidV7.generate(), email, email, name, roles, "ACTIVE",
                beeLevel, now);
        users.save(user);
        credentials.save(new Credential(UuidV7.generate(), user.id,
                Credential.CredentialType.PASSWORD, hasher.hash(DEMO_PASSWORD), now));
        return user;
    }

    private Namespace namespace(String name, java.util.UUID owner, Instant now) {
        Namespace ns = new Namespace(UuidV7.generate(), name, owner, null, true, now);
        namespaces.save(ns);
        return ns;
    }

    private Listing listing(StoreUser publisher, ListingType type, String namespace, String slug,
            String name, String summary, String category, List<String> tags, Channel channel,
            Instant now) {
        Namespace ns = namespaces.findByName(namespace).orElseThrow();
        Listing listing = new Listing();
        listing.id = UuidV7.generate();
        listing.namespaceId = ns.id();
        listing.namespace = namespace;
        listing.slug = slug;
        listing.type = type;
        listing.visibility = dev.infinia.store.contract.type.ListingVisibility.PUBLIC;
        listing.status = "ACTIVE";
        listing.category = category;
        listing.tags = new ArrayList<>(tags);
        listing.iconUrl = null;
        listing.defaultChannel = channel;
        listing.publisherUserId = publisher.id;
        listing.downloads = type == ListingType.APP ? 50_000 : 1_000 + tags.size() * 137;
        listing.favoriteCount = type == ListingType.FLOW ? 128 : 64;
        listing.createdAt = now;
        listing.updatedAt = now;
        listing.localizations = new ArrayList<>(List.of(
                new Listing.Localization("en", name, summary, "# " + name + "\n\n" + summary
                        + "\n\nSeeded demo listing for the Infinia Store.", null),
                new Listing.Localization("zh-CN", name, summary + "（中文摘要）",
                        "# " + name + "\n\n" + stripTrailingSentenceEnd(summary)
                                + "。这是 Infinia 商店的演示商品。", null)));
        listings.save(listing);
        return listing;
    }

    /** English demo summaries usually end with a period; drop it so the joined
     *  Chinese sentence never renders a doubled “。。”. */
    private static String stripTrailingSentenceEnd(String text) {
        return text.replaceAll("[.。\\s]+$", "");
    }

    private Release publish(Listing listing, String version, Channel channel, String requiresHost,
            int rollout, Instant now, Release.ArtifactInfo... artifacts) {
        Release release = draft(listing, version, channel, requiresHost, now);
        release.rolloutPercent = rollout;
        release.artifacts = new ArrayList<>(List.of(artifacts));
        finish(release, listing, now);
        return release;
    }

    private Release draft(Listing listing, String version, Channel channel, String requiresHost,
            Instant now) {
        Release release = new Release();
        release.id = UuidV7.generate();
        release.listingId = listing.id;
        release.version = SemVer.parse(version);
        release.status = ReleaseStatus.DRAFT;
        release.channel = channel;
        release.createdAt = now;
        release.requiresHost = requiresHost;
        release.license = "MIT";
        release.sourceUrl = "https://github.com/MuskStark/FengYu-WebSite";
        release.changelogMarkdown = "- Initial seeded release " + version;
        release.rolloutPercent = 100;
        releases.save(release);
        return release;
    }

    private Release.ArtifactInfo installerArtifact(Listing listing, String version, Platform p,
            Arch a, String variant, String filename, Instant now) throws IOException {
        // Fake installer bytes — APP packages rely on code signing in the real pipeline.
        byte[] content = ("infinia-installer:" + listing.slug + ":" + version + ":" + p + ":"
                + a + ":" + variant).getBytes(StandardCharsets.UTF_8);
        return blobArtifact(p, a, filename, content, ArtifactKind.INSTALLER, variant, now);
    }

    private Release.ArtifactInfo portableArtifact(Listing listing, String version, Platform p,
            Arch a, String variant, String filename, Instant now) throws IOException {
        byte[] content = ("infinia-portable:" + listing.slug + ":" + version + ":" + p + ":"
                + a + ":" + variant).getBytes(StandardCharsets.UTF_8);
        return blobArtifact(p, a, filename, content, ArtifactKind.PORTABLE, variant, now);
    }

    private Release.ArtifactInfo packageArtifact(Listing listing, String version, String filename,
            byte[] content, Instant now) {
        return blobArtifact(Platform.UNIVERSAL, Arch.UNIVERSAL, filename, content,
                ArtifactKind.PACKAGE, "default", now);
    }

    private void attachPackage(Release release, Platform p, Arch a, String filename,
            byte[] content, Instant now) {
        release.artifacts = new ArrayList<>(release.artifacts);
        release.artifacts.add(blobArtifact(p, a, filename, content, ArtifactKind.PACKAGE,
                "default", now));
    }

    private Release.ArtifactInfo blobArtifact(Platform p, Arch a, String filename, byte[] content,
            ArtifactKind kind, String variant, Instant now) {
        String blobKey = blobs.put(new ByteArrayInputStream(content), 100_000_000, null);
        return new Release.ArtifactInfo(UuidV7.generate(), kind, p, a, variant, filename,
                content.length,
                Ed25519Signer.sha256Hex(content), null, null, blobKey,
                content.length > 0 && content[0] == '{' ? "application/json" : "application/zip");
    }

    /** Signs the envelope, flips the release to PUBLISHED with platform signature. */
    private void finish(Release release, Listing listing, Instant now) {
        release.status = ReleaseStatus.PUBLISHED;
        release.publishedAt = now;
        String envelopeJson = catalog.canonicalJson(catalog.buildEnvelope(listing, release));
        String signature = signing.sign(envelopeJson);
        String keyId = signing.currentKeyId();
        release.artifacts = new ArrayList<>(release.artifacts);
        for (int i = 0; i < release.artifacts.size(); i++) {
            Release.ArtifactInfo a = release.artifacts.get(i);
            release.artifacts.set(i, new Release.ArtifactInfo(a.id(), a.kind(), a.platform(),
                    a.arch(), a.variant(), a.filename(), a.size(), a.sha256(),
                    signing.sign(blobs.open(a.blobKey())), keyId,
                    a.blobKey(),
                    a.mimeType()));
        }
        releases.save(release);
    }

    static byte[] zipOf(String[][] entries) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(out)) {
            for (String[] entry : entries) {
                zos.putNextEntry(new ZipEntry(entry[0]));
                zos.write(entry[1].getBytes(StandardCharsets.UTF_8));
                zos.closeEntry();
            }
        }
        return out.toByteArray();
    }
}
