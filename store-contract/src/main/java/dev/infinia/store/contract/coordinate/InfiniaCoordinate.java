package dev.infinia.store.contract.coordinate;

import dev.infinia.store.contract.semver.SemVer;
import dev.infinia.store.contract.type.ListingType;

import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Global listing coordinate: {@code infinia://<type>/<namespace>/<slug>[@<semver>]}.
 * The version segment is optional — a coordinate without a version identifies the
 * listing itself, with a version it identifies a concrete release (design §6.1).
 *
 * <p>Example: {@code infinia://plugin/official/markdown@4.0.0-beta.5}</p>
 */
public final class InfiniaCoordinate {

    public static final String SCHEME = "infinia://";

    /**
     * Segments are lowercase alphanumerics plus hyphens. The NAMESPACE additionally
     * allows interior dots so a publisher's reverse-DNS-style prefix maps onto one
     * namespace (the official FengYu plugins live under {@code fan.summer}, whose
     * coordinate is {@code infinia://plugin/fan.summer/<slug>} and whose catalog id
     * — {@code namespace + "." + slug} — must equal the plugin's manifest id
     * {@code fan.summer.<slug>}); a slug never carries a dot because the id's dot
     * separator belongs to the namespace/slug boundary.
     */
    private static final Pattern SEGMENT = Pattern.compile("[a-z0-9][a-z0-9-]{0,62}");
    private static final Pattern NAMESPACE_SEGMENT =
            Pattern.compile("[a-z0-9][a-z0-9.-]{0,62}");
    private static final Pattern COORDINATE = Pattern.compile(
            "^infinia://([a-z]+)/([a-z0-9][a-z0-9.-]{0,62})/([a-z0-9][a-z0-9-]{0,62})(?:@(.+))?$",
            Pattern.CASE_INSENSITIVE);

    public final ListingType type;
    public final String namespace;
    public final String slug;
    public final SemVer version; // nullable

    private InfiniaCoordinate(ListingType type, String namespace, String slug, SemVer version) {
        this.type = Objects.requireNonNull(type);
        this.namespace = Objects.requireNonNull(namespace);
        this.slug = Objects.requireNonNull(slug);
        this.version = version;
    }

    public static InfiniaCoordinate of(ListingType type, String namespace, String slug) {
        validate(type, namespace, slug);
        return new InfiniaCoordinate(type, namespace.toLowerCase(), slug.toLowerCase(), null);
    }

    public static InfiniaCoordinate of(ListingType type, String namespace, String slug, SemVer version) {
        validate(type, namespace, slug);
        return new InfiniaCoordinate(type, namespace.toLowerCase(), slug.toLowerCase(),
                Objects.requireNonNull(version));
    }

    public static InfiniaCoordinate parse(String input) {
        Objects.requireNonNull(input, "coordinate must not be null");
        Matcher m = COORDINATE.matcher(input.trim());
        if (!m.matches()) {
            throw new IllegalArgumentException(
                    "Invalid coordinate (expected infinia://<type>/<namespace>/<slug>[@version]): " + input);
        }
        ListingType type = ListingType.fromUriScheme(m.group(1));
        SemVer version = m.group(4) == null ? null : SemVer.parse(m.group(4));
        return new InfiniaCoordinate(type, m.group(2).toLowerCase(), m.group(3).toLowerCase(), version);
    }

    /** Coordinate without the version segment (identifies the listing). */
    public InfiniaCoordinate listingPart() {
        return version == null ? this : new InfiniaCoordinate(type, namespace, slug, null);
    }

    public InfiniaCoordinate withVersion(SemVer v) {
        return new InfiniaCoordinate(type, namespace, slug, v);
    }

    private static void validate(ListingType type, String namespace, String slug) {
        if (!NAMESPACE_SEGMENT.matcher(namespace).matches()) {
            throw new IllegalArgumentException("Invalid namespace segment: " + namespace);
        }
        if (!SEGMENT.matcher(slug).matches()) {
            throw new IllegalArgumentException("Invalid slug segment: " + slug);
        }
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof InfiniaCoordinate c
                && type == c.type && namespace.equals(c.namespace) && slug.equals(c.slug)
                && Objects.equals(version, c.version);
    }

    @Override
    public int hashCode() {
        return Objects.hash(type, namespace, slug, version);
    }

    @Override
    public String toString() {
        return SCHEME + type.name().toLowerCase() + "/" + namespace + "/" + slug
                + (version == null ? "" : "@" + version);
    }
}
