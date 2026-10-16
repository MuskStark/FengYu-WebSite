package dev.infinia.store.scanner;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Package scanning facade (design §8.2 steps 3-6). Validates native manifests of all
 * five artifact classes, runs secret / malicious-content heuristics and produces a
 * CycloneDX SBOM. Blocking findings cause automatic policy rejection.
 */
public class PackageScanner {

    /** Non-archive templates are read back in full — hard-capped small (design §8.2). */
    private static final long MAX_TEMPLATE_BYTES = 16L * 1024 * 1024;
    /**
     * Archive kinds (PLUGIN .fyp / FLOW .fyflow) stay compressed on disk. The cap
     * mirrors the host's {@code PluginPackageService.MAX_PACKAGE_BYTES} (100 MB) —
     * a larger package would pass the store and then be refused at install time —
     * while the expanded content is bounded by SafeZip's own limits.
     */
    private static final long MAX_ARCHIVE_BYTES = 100L * 1024 * 1024;
    /** Host {@code PluginPackageService.MAX_MANIFEST_BYTES}. */
    private static final long MAX_MANIFEST_BYTES = 1024 * 1024;
    /** Host {@code SkillPackageService} ceilings: 10 MB package, 50 MB expanded (verbatim). */
    private static final long MAX_SKILL_PACKAGE_BYTES = 10L * 1024 * 1024;
    private static final long MAX_SKILL_EXPANDED_BYTES = 50L * 1024 * 1024;
    /** Host {@code PluginPackageService} timeout / resource ceilings, verbatim. */
    private static final long MIN_TIMEOUT_SECONDS = 1L;
    private static final long MAX_TIMEOUT_SECONDS = 600L;

    private final ObjectMapper mapper = new ObjectMapper();
    private final SafeZip.Limits limits;

    public PackageScanner() {
        this(SafeZip.Limits.defaults());
    }

    public PackageScanner(SafeZip.Limits limits) {
        this.limits = limits;
    }

    public ScanResult scan(String listingType, String expectedVersion, byte[] content) {
        return scan(listingType, expectedVersion, content, false);
    }

    /**
     * @param platformTrusted the package is published by the platform itself
     *        (PLATFORM_ADMIN listing owner): the reserved official-namespace /
     *        official-flag rules do not apply — the platform is the one
     *        FengYu-trusted publisher those rules protect (see
     *        {@code trusted-store-keys.json} on the host side).
     */
    public ScanResult scan(String listingType, String expectedVersion, byte[] content,
            boolean platformTrusted) {
        ScanResult result = new ScanResult();
        result.mimeType = sniffMime(content);
        try {
            switch (listingType.toUpperCase(Locale.ROOT)) {
                case "PLUGIN" -> scanZipPackage(content, expectedVersion, result, "manifest.json",
                        "PLUGIN", platformTrusted);
                case "SKILL" -> scanSkill(content, expectedVersion, result, platformTrusted);
                case "FLOW" -> scanFlow(content, expectedVersion, result);
                case "MCP" -> scanMcpTemplate(content, expectedVersion, result);
                case "APP" -> scanApp(content, expectedVersion, result);
                default -> result.error("scanner.unknown-type",
                        "Unsupported listing type: " + listingType);
            }
        } catch (ScanViolation violation) {
            result.findings.add(new ScanResult.Finding("CRITICAL", violation.rule,
                    violation.getMessage(), null));
        } catch (IOException e) {
            result.error("scanner.io", "Package could not be read: " + e.getMessage());
        }
        return result;
    }

    /**
     * Disk-backed scan entry point for the publishing pipeline and live upstream
     * delivery. SKILL archives are inspected through {@link ZipFile} entry-by-entry;
     * PLUGIN and FLOW are zip archives too — their compressed copy is capped at
     * {@link #MAX_ARCHIVE_BYTES} while SafeZip bounds the expanded content, so a
     * legitimate plugin above the template read-back cap still scans. Only
     * non-archive templates (MCP JSON) are read back in full under 16 MiB.
     */
    public ScanResult scan(String listingType, String expectedVersion, Path content) {
        return scan(listingType, expectedVersion, content, false);
    }

    public ScanResult scan(String listingType, String expectedVersion, Path content,
            boolean platformTrusted) {
        String type = listingType == null ? "" : listingType.toUpperCase(Locale.ROOT);
        if (type.equals("SKILL")) {
            ScanResult result = new ScanResult();
            result.mimeType = "application/zip";
            try {
                if (Files.size(content) > MAX_SKILL_PACKAGE_BYTES) {
                    result.error("scanner.skill-too-large",
                            "Skill package exceeds the host's 10 MB package limit");
                    return result;
                }
                scanSkill(content, expectedVersion, result, platformTrusted);
            } catch (ScanViolation violation) {
                result.findings.add(new ScanResult.Finding("CRITICAL", violation.rule,
                        violation.getMessage(), null));
            } catch (IOException e) {
                result.error("scanner.io", "Package could not be read: " + e.getMessage());
            }
            return result;
        }
        boolean archive = type.equals("PLUGIN") || type.equals("FLOW");
        long cap = archive ? MAX_ARCHIVE_BYTES : MAX_TEMPLATE_BYTES;
        try {
            if (Files.size(content) > cap) {
                ScanResult result = new ScanResult();
                result.error(archive ? "scanner.archive-too-large" : "scanner.file-too-large",
                        archive
                                ? "Archive exceeds the " + (MAX_ARCHIVE_BYTES >> 20)
                                        + " MiB compressed scan limit"
                                : "Non-archive template exceeds the 16 MiB scan limit");
                return result;
            }
            return scan(listingType, expectedVersion, Files.readAllBytes(content),
                    platformTrusted);
        } catch (IOException e) {
            ScanResult result = new ScanResult();
            result.error("scanner.io", "Package could not be read: " + e.getMessage());
            return result;
        }
    }

    // ---- PLUGIN (.fyp zip with a manifest.json at the root) ----

    private void scanZipPackage(byte[] content, String expectedVersion, ScanResult result,
            String manifestName, String typeLabel, boolean platformTrusted) throws IOException {
        Map<String, SafeZip.ExtractedFile> files = SafeZip.extract(new ByteArrayInputStream(content),
                limits);
        result.files.addAll(files.keySet());
        SafeZip.ExtractedFile manifest = files.get(manifestName);
        if (manifest == null) {
            result.error("plugin.manifest-missing", "Missing " + manifestName + " manifest");
            return;
        }
        // Host: manifest.json larger than 1 MB is refused before parsing.
        if (manifest.content().length > MAX_MANIFEST_BYTES) {
            result.error("plugin.manifest-too-large",
                    manifestName + " exceeds the host's 1 MB manifest limit");
        }
        JsonNode json;
        try {
            json = mapper.readTree(manifest.content());
        } catch (IOException e) {
            result.error("plugin.manifest-invalid", manifestName + " is not valid JSON");
            return;
        }
        result.manifestName = text(json, "name");
        result.manifestVersion = text(json, "version");

        // ---- rules mirrored from the FengYu host's PluginManifest validator ----
        if (json.path("schemaVersion").asInt(-1) != FengYuHostRules.PLUGIN_SCHEMA_VERSION) {
            result.error("plugin.schema-version", "plugin.json schemaVersion must be "
                    + FengYuHostRules.PLUGIN_SCHEMA_VERSION);
        }
        String id = text(json, "id");
        if (id == null || !FengYuHostRules.ID_PATTERN.matcher(id).matches()) {
            result.error("plugin.manifest-field",
                    "plugin.json 'id' must be a lowercase reverse-domain identifier");
        } else if (!platformTrusted && id.startsWith(FengYuHostRules.OFFICIAL_NAMESPACE)) {
            result.error("plugin.namespace-reserved",
                    "id must not use the reserved " + FengYuHostRules.OFFICIAL_NAMESPACE
                            + "* namespace");
        }
        if (!platformTrusted && Boolean.TRUE.equals(json.path("official").asBoolean(false))) {
            result.error("plugin.official-reserved",
                    "Only FengYu-trusted publishers may declare official:true");
        }
        for (String required : new String[] {"name", "description", "author", "icon",
                "category", "version"}) {
            if (isBlank(text(json, required))) {
                result.error("plugin.manifest-field",
                        "Manifest field '" + required + "' is required by the host");
            }
        }
        if (result.manifestVersion == null) {
            result.error("plugin.manifest-field", "Manifest field 'version' is required");
        } else if (!result.manifestVersion.equals(expectedVersion)) {
            result.error("plugin.version-mismatch",
                    "Manifest version " + result.manifestVersion + " does not match release version "
                            + expectedVersion);
        } else if (!FengYuHostRules.SEMVER_PATTERN.matcher(result.manifestVersion).matches()) {
            // Host: SemanticVersion.isValid — a manifest version the host cannot parse
            // would fail install even when it happens to equal the release version.
            result.error("plugin.version-format", "Plugin version must be semantic versioning");
        }
        // The host resolves the UI through ui.entry (not the legacy entry field).
        JsonNode uiEntry = json.path("ui").path("entry");
        if (!uiEntry.isTextual() || isBlank(uiEntry.asText())
                || files.get(uiEntry.asText()) == null) {
            result.error("plugin.ui-entry-missing",
                    "ui.entry must be declared and present inside the package");
        }
        JsonNode permissions = json.get("permissions");
        if (permissions != null && permissions.isArray()) {
            // Host format: array of permission tokens from a fixed allowlist.
            for (JsonNode p : permissions) {
                if (!p.isTextual()) {
                    result.error("plugin.permissions-format",
                            "permissions must be an array of strings (host contract)");
                    break;
                }
                String token = p.asText();
                if (!FengYuHostRules.isPluginPermissionAllowed(token)) {
                    result.error("plugin.permission-not-allowed",
                            "Permission '" + token + "' is not in the host allowlist "
                                    + FengYuHostRules.PLUGIN_PERMISSIONS);
                } else {
                    result.extractedPermissions.add(Map.of("permissionId", token));
                }
            }
        }
        String engines = text(json.path("engines"), "fengyu");
        if (engines != null && !FengYuHostRules.hostCompatibleRange(engines)) {
            result.error("plugin.engines-syntax",
                    "engines.fengyu must be a valid FengYu range: comparators "
                            + "(>=4.0.0, <5.0.0, =4.0.0), npm-style ^4.1.2 / ~4.1.2, wildcards "
                            + "* / 1.x / 1.2.x, combined by spaces and ||");
        }
        JsonNode backend = json.path("backend");
        String backendRuntime = text(backend, "runtime");
        if (backendRuntime != null
                && !FengYuHostRules.pluginBackendRuntimes().contains(backendRuntime)) {
            result.error("plugin.backend-runtime",
                    "backend.runtime must be one of " + FengYuHostRules.pluginBackendRuntimes());
        }
        validateBackendContract(json, backend, backendRuntime, files, result);
        scanContents(files, result);
        result.sbom = SbomGenerator.generate(typeLabel, expectedVersion,
                Ed25519Signer.sha256Hex(content), files);
    }

    /**
     * Install-time contract of a declared {@code backend} block, mirrored from the host's
     * {@code PluginPackageService.validate} (worker artifact presence, protocol version,
     * timeout / resource ceilings, rpc method table, AI tool references) so a store approval
     * cannot be rejected at install time over a block the store never looked at.
     *
     * <p>Known gaps, still enforced by the host at install time: flowNodes / i18n
     * flow-overlay validation and PluginHostVersion.requireCompatible (both depend on
     * host-side state — the bundled builtin list and the running host version).</p>
     */
    private void validateBackendContract(JsonNode json, JsonNode backend, String backendRuntime,
            Map<String, SafeZip.ExtractedFile> files, ScanResult result) {
        if (!backend.isObject()) {
            return;
        }
        // Host defaults a missing runtime to java, then requires the conventional artifact.
        String runtime = backendRuntime == null || backendRuntime.isBlank()
                ? "java" : backendRuntime;
        // The store cannot know the installing host's OS; for `go` either flavor counts.
        boolean workerPresent = files.containsKey(FengYuHostRules.workerArtifact(runtime, false))
                || (runtime.equals("go")
                        && files.containsKey(FengYuHostRules.workerArtifact("go", true)));
        if (!workerPresent) {
            result.error("plugin.backend-artifact-missing",
                    "Plugin backend artifact does not exist: "
                            + FengYuHostRules.workerArtifact(runtime, false));
        }
        JsonNode protocol = backend.path("protocolVersion");
        if (protocol.isInt() && protocol.asInt() != 1) {
            result.error("plugin.backend-protocol-version",
                    "Unsupported backend.protocolVersion: " + protocol.asInt());
        }
        JsonNode timeout = backend.path("callTimeoutSeconds");
        if (timeout.isNumber() && (timeout.asLong() < MIN_TIMEOUT_SECONDS
                || timeout.asLong() > MAX_TIMEOUT_SECONDS)) {
            result.error("plugin.backend-timeout",
                    "backend.callTimeoutSeconds must be between "
                            + MIN_TIMEOUT_SECONDS + " and " + MAX_TIMEOUT_SECONDS + " seconds");
        }
        JsonNode resources = backend.path("resources");
        if (resources.isObject()) {
            JsonNode memoryMb = resources.path("memoryMb");
            if (memoryMb.isNumber() && (memoryMb.asLong() < 64 || memoryMb.asLong() > 8192)) {
                result.error("plugin.backend-resources",
                        "backend.resources.memoryMb must be between 64 and 8192");
            }
            JsonNode maxProcesses = resources.path("maxProcesses");
            if (maxProcesses.isInt() && (maxProcesses.asInt() < 1 || maxProcesses.asInt() > 64)) {
                result.error("plugin.backend-resources",
                        "backend.resources.maxProcesses must be between 1 and 64");
            }
        }

        // T2-04: a declared worker must expose at least one rpc method, and every
        // schema must be a JSON-Schema OBJECT node (never an escaped string).
        JsonNode methods = json.path("rpc").path("methods");
        boolean hasMethods = methods.isObject() && methods.size() > 0;
        if (!hasMethods) {
            result.error("plugin.rpc-methods-missing",
                    "Plugin declares a backend but no rpc.methods — a worker must expose "
                            + "at least one method");
        }
        if (methods.isObject()) {
            methods.fields().forEachRemaining(method -> {
                if (!isObjectSchema(method.getValue().path("inputSchema"))) {
                    result.error("plugin.rpc-schema", "rpc.methods." + method.getKey()
                            + ".inputSchema must be a JSON object schema");
                }
                JsonNode outputSchema = method.getValue().path("outputSchema");
                if (!outputSchema.isMissingNode() && !outputSchema.isNull()
                        && !isObjectSchema(outputSchema)) {
                    result.error("plugin.rpc-schema", "rpc.methods." + method.getKey()
                            + ".outputSchema must be a JSON object schema");
                }
                JsonNode methodTimeout = method.getValue().path("timeoutSeconds");
                if (methodTimeout.isNumber() && (methodTimeout.asLong() < MIN_TIMEOUT_SECONDS
                        || methodTimeout.asLong() > MAX_TIMEOUT_SECONDS)) {
                    result.error("plugin.rpc-timeout", "rpc.methods." + method.getKey()
                            + ".timeoutSeconds must be between " + MIN_TIMEOUT_SECONDS
                            + " and " + MAX_TIMEOUT_SECONDS + " seconds");
                }
            });
        }

        // AI tools reference rpc methods by name and carry mandatory effect metadata.
        java.util.Set<String> toolNames = new java.util.HashSet<>();
        JsonNode aiTools = json.path("aiTools");
        if (aiTools.isArray()) {
            for (JsonNode tool : aiTools) {
                String name = text(tool, "name");
                if (name == null || isBlank(name) || !toolNames.add(name)) {
                    result.error("plugin.ai-tool", "Invalid or duplicate AI tool name: " + name);
                    continue;
                }
                String method = text(tool, "method");
                if (isBlank(method) || !methods.has(method)) {
                    result.error("plugin.ai-tool",
                            "AI tool " + name + " references unknown method: " + method);
                }
                String effect = text(tool, "effect");
                if (effect == null
                        || !java.util.Set.of("read", "write", "external").contains(effect)) {
                    result.error("plugin.ai-tool", "Invalid effect for AI tool " + name);
                }
                JsonNode toolTimeout = tool.path("timeoutSeconds");
                if (toolTimeout.isNumber() && (toolTimeout.asLong() < MIN_TIMEOUT_SECONDS
                        || toolTimeout.asLong() > MAX_TIMEOUT_SECONDS)) {
                    result.error("plugin.ai-tool", "AI tool " + name
                            + ".timeoutSeconds must be between " + MIN_TIMEOUT_SECONDS
                            + " and " + MAX_TIMEOUT_SECONDS + " seconds");
                }
            }
        }
    }

    /** A JsonNode is a valid OBJECT input/output schema when it has {@code type:"object"}. */
    private static boolean isObjectSchema(JsonNode schema) {
        return schema != null && schema.isObject()
                && schema.has("type") && "object".equals(schema.get("type").asText());
    }

    // ---- SKILL (.fys zip with manifest.json + SKILL.md) ----

    private void scanSkill(byte[] content, String expectedVersion, ScanResult result,
            boolean platformTrusted) throws IOException {
        Map<String, SafeZip.ExtractedFile> files = SafeZip.extract(new ByteArrayInputStream(content),
                limits);
        result.files.addAll(files.keySet());

        // ---- rules mirrored from the FengYu host's SkillManifest validator ----
        SafeZip.ExtractedFile manifest = files.get("manifest.json");
        if (manifest == null) {
            result.error("skill.manifest-missing",
                    "Missing manifest.json (host skill package contract)");
            return;
        }
        JsonNode json;
        try {
            json = mapper.readTree(manifest.content());
        } catch (IOException e) {
            result.error("skill.manifest-invalid", "manifest.json is not valid JSON");
            return;
        }
        result.manifestName = text(json, "name");
        result.manifestVersion = text(json, "version");
        if (json.path("schemaVersion").asInt(-1) != FengYuHostRules.SKILL_SCHEMA_VERSION) {
            result.error("skill.schema-version", "manifest.json schemaVersion must be "
                    + FengYuHostRules.SKILL_SCHEMA_VERSION);
        }
        String id = text(json, "id");
        if (id == null || !FengYuHostRules.ID_PATTERN.matcher(id).matches()) {
            result.error("skill.manifest-field",
                    "manifest.json 'id' must be a lowercase reverse-domain identifier");
        } else if (!platformTrusted && (id.startsWith(FengYuHostRules.OFFICIAL_NAMESPACE)
                || Boolean.TRUE.equals(json.path("official").asBoolean(false)))) {
            result.error("skill.official-reserved",
                    "Only FengYu-trusted publishers may use the official namespace");
        }
        if (isBlank(result.manifestName)) {
            result.error("skill.manifest-field", "Manifest field 'name' is required");
        }
        if (result.manifestVersion == null
                || !FengYuHostRules.SKILL_VERSION_PATTERN.matcher(result.manifestVersion)
                        .matches()) {
            result.error("skill.manifest-field",
                    "Manifest field 'version' must be MAJOR.MINOR.PATCH");
        } else if (!result.manifestVersion.equals(expectedVersion)) {
            result.error("plugin.version-mismatch",
                    "Manifest version " + result.manifestVersion + " does not match release version "
                            + expectedVersion);
        }
        // The host only requires SKILL.md at the package root — no frontmatter parsing.
        if (files.get("SKILL.md") == null) {
            result.error("skill.skill-md-missing", "SKILL.md must exist at the package root");
        }
        scanContents(files, result);
        result.sbom = SbomGenerator.generate("SKILL", expectedVersion,
                Ed25519Signer.sha256Hex(content), files);
    }

    private void scanSkill(Path content, String expectedVersion, ScanResult result,
            boolean platformTrusted) throws IOException {
        Map<String, Long> inventory = new LinkedHashMap<>();
        byte[] manifestBytes = null;
        boolean hasSkillMd = false;
        long total = 0;
        int entries = 0;
        try (ZipFile zip = new ZipFile(content.toFile())) {
            Enumeration<? extends ZipEntry> cursor = zip.entries();
            while (cursor.hasMoreElements()) {
                ZipEntry entry = cursor.nextElement();
                entries++;
                if (entries > limits.maxEntries()) {
                    throw new ScanViolation("zip.too-many-entries",
                            "Archive exceeds the maximum of " + limits.maxEntries()
                                    + " entries");
                }
                SafeZip.validatePath(entry.getName());
                if (entry.isDirectory()) {
                    continue;
                }
                long size = entry.getSize();
                long compressed = entry.getCompressedSize();
                if (size < 0 || size > limits.maxEntryBytes()) {
                    throw new ScanViolation("zip.entry-too-large",
                            "Entry " + entry.getName() + " exceeds the single-entry size limit");
                }
                total += size;
                if (total > limits.maxTotalBytes()) {
                    throw new ScanViolation("zip.total-too-large",
                            "Archive exceeds the total uncompressed size limit");
                }
                // Host SkillPackageService.extract: expanded content is capped at 50 MB.
                if (total > MAX_SKILL_EXPANDED_BYTES) {
                    throw new ScanViolation("skill.total-too-large",
                            "Archive exceeds the host's 50 MB expanded size limit");
                }
                if (compressed > 0 && size / compressed > limits.maxRatio()) {
                    throw new ScanViolation("zip.bomb",
                            "Entry " + entry.getName() + " exceeds the compression ratio limit");
                }
                if (inventory.putIfAbsent(entry.getName(), size) != null) {
                    throw new ScanViolation("zip.duplicate-entry",
                            "Archive contains duplicate entry " + entry.getName());
                }
                result.files.add(entry.getName());
                if ("SKILL.md".equals(entry.getName())) {
                    hasSkillMd = true;
                }
                if ("manifest.json".equals(entry.getName())) {
                    manifestBytes = readEntry(zip, entry, 2L * 1024 * 1024);
                }
                if (size <= 2L * 1024 * 1024) {
                    byte[] text = readEntry(zip, entry, 2L * 1024 * 1024);
                    ContentScanners.scanFile(entry.getName(),
                            new String(text, StandardCharsets.UTF_8), result);
                }
            }
        }
        if (manifestBytes == null) {
            result.error("skill.manifest-missing",
                    "Missing manifest.json (host skill package contract)");
            return;
        }
        JsonNode json;
        try {
            json = mapper.readTree(manifestBytes);
        } catch (IOException e) {
            result.error("skill.manifest-invalid", "manifest.json is not valid JSON");
            return;
        }
        validateSkillManifest(json, expectedVersion, hasSkillMd, result, platformTrusted);
        result.sbom = SbomGenerator.generateInventory("SKILL", expectedVersion,
                sha256Hex(content), inventory);
    }

    private void validateSkillManifest(JsonNode json, String expectedVersion,
            boolean hasSkillMd, ScanResult result, boolean platformTrusted) {
        result.manifestName = text(json, "name");
        result.manifestVersion = text(json, "version");
        if (json.path("schemaVersion").asInt(-1) != FengYuHostRules.SKILL_SCHEMA_VERSION) {
            result.error("skill.schema-version", "manifest.json schemaVersion must be "
                    + FengYuHostRules.SKILL_SCHEMA_VERSION);
        }
        String id = text(json, "id");
        if (id == null || !FengYuHostRules.ID_PATTERN.matcher(id).matches()) {
            result.error("skill.manifest-field",
                    "manifest.json 'id' must be a lowercase reverse-domain identifier");
        } else if (!platformTrusted && (id.startsWith(FengYuHostRules.OFFICIAL_NAMESPACE)
                || Boolean.TRUE.equals(json.path("official").asBoolean(false)))) {
            result.error("skill.official-reserved",
                    "Only FengYu-trusted publishers may use the official namespace");
        }
        if (isBlank(result.manifestName)) {
            result.error("skill.manifest-field", "Manifest field 'name' is required");
        }
        if (result.manifestVersion == null
                || !FengYuHostRules.SKILL_VERSION_PATTERN.matcher(result.manifestVersion)
                        .matches()) {
            result.error("skill.manifest-field",
                    "Manifest field 'version' must be MAJOR.MINOR.PATCH");
        } else if (!result.manifestVersion.equals(expectedVersion)) {
            result.error("plugin.version-mismatch",
                    "Manifest version " + result.manifestVersion
                            + " does not match release version " + expectedVersion);
        }
        if (!hasSkillMd) {
            result.error("skill.skill-md-missing", "SKILL.md must exist at the package root");
        }
    }

    // ---- FLOW (.fyflow zip: manifest.json + workflow.json + dependencies.lock.json) ----

    private void scanFlow(byte[] content, String expectedVersion, ScanResult result)
            throws IOException {
        Map<String, SafeZip.ExtractedFile> files = SafeZip.extract(new ByteArrayInputStream(content),
                limits);
        result.files.addAll(files.keySet());
        requireFile(files, "manifest.json", "flow.manifest-missing", result);
        SafeZip.ExtractedFile workflow = requireFile(files, "workflow.json",
                "flow.workflow-missing", result);
        requireFile(files, "dependencies.lock.json", "flow.lock-missing", result);

        if (workflow != null) {
            try {
                JsonNode wf = mapper.readTree(workflow.content());
                if (wf.get("inputSchema") == null || wf.get("plan") == null) {
                    result.error("flow.workflow-schema",
                            "workflow.json must define inputSchema and plan");
                }
            } catch (IOException e) {
                result.error("flow.workflow-invalid", "workflow.json is not valid JSON");
            }
        }
        scanContents(files, result);
        result.sbom = SbomGenerator.generate("FLOW", expectedVersion,
                Ed25519Signer.sha256Hex(content), files);
    }

    // ---- MCP (JSON template, design §6.4) ----

    private void scanMcpTemplate(byte[] content, String expectedVersion, ScanResult result)
            throws IOException {
        JsonNode json;
        try {
            json = mapper.readTree(content);
        } catch (IOException e) {
            result.error("mcp.manifest-invalid", "MCP template is not valid JSON");
            return;
        }
        result.manifestName = text(json, "name");
        if (result.manifestName == null) {
            result.error("mcp.manifest-field", "Template field 'name' is required");
        }
        String transport = text(json, "transport");
        if (transport == null) {
            result.error("mcp.manifest-field", "Template field 'transport' is required");
        } else {
            String url = text(json, "urlTemplate");
            if (transport.equals("STDIO")) {
                String command = text(json, "commandTemplate");
                if (command == null || command.isBlank()) {
                    result.error("mcp.stdio-command-missing",
                            "STDIO templates must declare commandTemplate");
                } else if (hasShellComposition(command)) {
                    result.error("mcp.command-injection",
                            "commandTemplate must not contain shell composition");
                }
            } else if (url != null && !url.startsWith("https://")) {
                result.error("mcp.url-not-https", "Remote MCP templates must use HTTPS URLs");
            }
            if (url == null && json.get("stdioDeployment") == null) {
                result.error("mcp.url-not-https",
                        "Templates need either an HTTPS urlTemplate or a stdioDeployment");
            }
        }
        // stdioDeployment block (aggregation plan §6.2): a pinned package with
        // registry, version and digest; commands must be structured, never shell.
        JsonNode stdio = json.get("stdioDeployment");
        if (stdio != null && stdio.isObject()) {
            String runtime = text(stdio, "runtime");
            if (runtime == null || !Set.of("npm", "pypi", "nuget", "docker", "mcpb")
                    .contains(runtime)) {
                result.error("mcp.stdio-runtime", "stdioDeployment runtime must be one of "
                        + "npm, pypi, nuget, docker, mcpb");
            }
            for (String required : new String[] {"package", "version", "digest"}) {
                if (isBlank(text(stdio, required))) {
                    result.error("mcp.stdio-pinned-package",
                            "stdioDeployment requires registry " + required
                                    + " — unpinned package installs are blocked");
                }
            }
            String command = text(stdio, "command");
            if (isBlank(command)) {
                result.error("mcp.stdio-command-missing",
                        "stdioDeployment must declare the launch command");
            } else if (hasShellComposition(command)) {
                result.error("mcp.command-injection",
                        "stdioDeployment command must be a single executable, no shell composition");
            }
            JsonNode args = stdio.get("args");
            if (args != null && !args.isArray()) {
                result.error("mcp.stdio-args-structured",
                        "stdioDeployment args must be a structured array");
            }
        }
        JsonNode defaultEnabled = json.get("defaultEnabled");
        if (defaultEnabled != null && defaultEnabled.asBoolean(false)) {
            result.error("mcp.default-enabled", "Templates must never install enabled");
        }
        JsonNode toolPolicy = json.get("toolPolicy");
        if (toolPolicy != null && toolPolicy.path("enabledByDefault").asBoolean(false)) {
            result.error("mcp.tools-enabled", "Tool policy must not enable tools by default");
        }
        Map<String, Object> asMap;
        try {
            asMap = mapper.convertValue(json, Map.class);
        } catch (IllegalArgumentException e) {
            asMap = Map.of();
        }
        ContentScanners.scanJsonForPlaintextSecrets(asMap, result);
        result.sbom = SbomGenerator.generate("MCP", expectedVersion,
                Ed25519Signer.sha256Hex(content), Map.of());
    }

    // ---- APP (platform installers; binaries are covered by code signing) ----

    private void scanApp(byte[] content, String expectedVersion, ScanResult result) {
        result.info("app.binary", "APP packages rely on platform code signing; no deep unpack");
        result.sbom = SbomGenerator.generate("APP", expectedVersion,
                Ed25519Signer.sha256Hex(content), Map.of());
    }

    // ---- helpers ----

    private SafeZip.ExtractedFile requireFile(Map<String, SafeZip.ExtractedFile> files, String name,
            String rule, ScanResult result) {
        SafeZip.ExtractedFile file = files.get(name);
        if (file == null) {
            result.error(rule, "Missing required file " + name);
        }
        return file;
    }

    private void scanContents(Map<String, SafeZip.ExtractedFile> files, ScanResult result) {
        for (Map.Entry<String, SafeZip.ExtractedFile> e : files.entrySet()) {
            ContentScanners.scanFile(e.getKey(), e.getValue().text(), result);
        }
    }

    private static byte[] readEntry(ZipFile zip, ZipEntry entry, long maxBytes)
            throws IOException {
        if (entry.getSize() > maxBytes) {
            throw new IOException("Entry exceeds read limit: " + entry.getName());
        }
        try (InputStream in = zip.getInputStream(entry);
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            long total = 0;
            int read;
            while ((read = in.read(buffer)) >= 0) {
                total += read;
                if (total > maxBytes) {
                    throw new IOException("Entry exceeds read limit: " + entry.getName());
                }
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private static String sha256Hex(Path path) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = Files.newInputStream(path)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) >= 0) {
                    if (read > 0) {
                        digest.update(buffer, 0, read);
                    }
                }
            }
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    /** One predicate for every "no shell composition" rule, so the checks cannot drift apart. */
    private static boolean hasShellComposition(String command) {
        return command.contains("$(") || command.contains("`") || command.contains(";")
                || command.contains("|") || command.contains("&&") || command.contains("||");
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static String sniffMime(byte[] content) {
        if (content.length >= 4 && (content[0] & 0xFF) == 0x50 && (content[1] & 0xFF) == 0x4B) {
            return "application/zip";
        }
        if (content.length >= 1 && (content[0] & 0xFF) == '{') {
            return "application/json";
        }
        return "application/octet-stream";
    }
}
