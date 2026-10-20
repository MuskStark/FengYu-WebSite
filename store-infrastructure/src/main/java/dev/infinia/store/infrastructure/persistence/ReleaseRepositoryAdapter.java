package dev.infinia.store.infrastructure.persistence;

import dev.infinia.store.contract.semver.SemVer;
import dev.infinia.store.contract.type.Arch;
import dev.infinia.store.contract.type.ArtifactKind;
import dev.infinia.store.contract.type.Channel;
import dev.infinia.store.contract.type.Platform;
import dev.infinia.store.contract.type.ReleaseStatus;
import dev.infinia.store.domain.model.Release;
import dev.infinia.store.domain.port.ReleaseRepository;
import dev.infinia.store.infrastructure.persistence.entity.ReleaseEntity;
import dev.infinia.store.infrastructure.persistence.repository.ReleaseJpaRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
public class ReleaseRepositoryAdapter implements ReleaseRepository {

    private static final List<String> VISIBLE_STATUSES =
            List.of(ReleaseStatus.PUBLISHED.name(), ReleaseStatus.DEPRECATED.name());

    private final ReleaseJpaRepository jpa;

    @PersistenceContext
    private EntityManager em;

    public ReleaseRepositoryAdapter(ReleaseJpaRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public Optional<Release> findById(UUID id) {
        return jpa.findById(id).map(ReleaseRepositoryAdapter::toDomain);
    }

    @Override
    public List<Release> findByListingId(UUID listingId) {
        return sortedByVersionDesc(jpa.findByListingId(listingId));
    }

    @Override
    public Optional<Release> findByListingIdAndVersion(UUID listingId, String version) {
        return jpa.findByListingIdAndVersion(listingId, version)
                .map(ReleaseRepositoryAdapter::toDomain);
    }

    @Override
    public Optional<Release> findLatestVisible(UUID listingId, Channel channel) {
        return jpa.findByListingId(listingId).stream()
                .filter(e -> VISIBLE_STATUSES.contains(e.status))
                .filter(e -> channel == null || Channel.valueOf(e.channel) == channel)
                .filter(e -> parseSafe(e.version) != null)
                .max(Comparator.comparing(e -> parseSafe(e.version)))
                .map(ReleaseRepositoryAdapter::toDomain);
    }

    @Override
    public List<Release> findVisibleByListingId(UUID listingId) {
        return jpa.findByListingId(listingId).stream()
                .filter(e -> VISIBLE_STATUSES.contains(e.status))
                .map(ReleaseRepositoryAdapter::toDomain)
                .sorted(Comparator.comparing((Release r) -> r.version).reversed())
                .toList();
    }

    @Override
    public List<Release> findVisibleByListingIds(java.util.Collection<UUID> listingIds) {
        if (listingIds.isEmpty()) {
            return List.of();
        }
        return jpa.findByListingIdIn(new ArrayList<>(listingIds)).stream()
                .filter(e -> VISIBLE_STATUSES.contains(e.status))
                .map(ReleaseRepositoryAdapter::toDomain)
                .toList();
    }

    @Override
    public List<Release> findByStatus(ReleaseStatus status) {
        return jpa.findByStatus(status.name()).stream()
                .map(ReleaseRepositoryAdapter::toDomain)
                .toList();
    }

    @Override
    public Optional<Release> findByArtifactBlobKey(String blobKey) {
        return jpa.findByArtifactBlobKey(blobKey).map(ReleaseRepositoryAdapter::toDomain);
    }

    @Override
    public List<Release> findVisibleByType(dev.infinia.store.contract.type.ListingType type) {
        // Type lives on the listing, not the release — join in the database instead
        // of loading every listing and every published release (audit P3).
        return jpa.findVisibleByType(type.name(), VISIBLE_STATUSES).stream()
                .map(ReleaseRepositoryAdapter::toDomain)
                .toList();
    }

    /**
     * Saves the domain snapshot as a detached entity carrying the row version it
     * was loaded with. Merging a versioned detached snapshot makes Hibernate
     * verify the version in both the persistence context and the UPDATE where
     * clause, so a concurrent writer between load and save surfaces as
     * {@link org.springframework.dao.OptimisticLockingFailureException}
     * instead of being silently overwritten (audit P1-4). The new row version is
     * written back so consecutive saves of one domain object stay valid.
     *
     * <p>The raw {@code jakarta.persistence.OptimisticLockException} Hibernate
     * raises is translated here: callers ({@code ScanPipeline},
     * {@code ScanOutcomeStore}) catch the Spring DAO type to let the concurrent
     * decision win, and this adapter does not go through a Spring Data repository
     * proxy that would translate it automatically.
     */
    @Override
    @Transactional
    public void save(Release release) {
        ReleaseEntity snapshot = new ReleaseEntity();
        copy(release, snapshot);
        snapshot.rowVersion = release.rowVersion;
        try {
            if (em.find(ReleaseEntity.class, release.id) == null) {
                em.persist(snapshot);
                em.flush();
                release.rowVersion = snapshot.rowVersion;
            } else {
                ReleaseEntity merged = em.merge(snapshot);
                em.flush();
                release.rowVersion = merged.rowVersion;
            }
        } catch (jakarta.persistence.OptimisticLockException stale) {
            throw new org.springframework.dao.OptimisticLockingFailureException(
                    "Stale release snapshot for " + release.id
                            + " — a concurrent writer already updated the row", stale);
        }
    }

    @Override
    @Transactional
    public void deleteById(UUID id) {
        jpa.deleteById(id);
    }

    private static List<Release> sortedByVersionDesc(List<ReleaseEntity> entities) {
        List<Release> result = new ArrayList<>();
        for (ReleaseEntity e : entities) {
            SemVer v = parseSafe(e.version);
            if (v != null) {
                result.add(toDomain(e));
            }
        }
        result.sort(Comparator.comparing((Release r) -> r.version).reversed());
        return result;
    }

    private static SemVer parseSafe(String version) {
        try {
            return SemVer.parse(version);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static void copy(Release r, ReleaseEntity e) {
        e.id = r.id;
        e.listingId = r.listingId;
        e.version = r.version.toString();
        e.status = r.status.name();
        e.channel = r.channel.name();
        e.publishedAt = r.publishedAt;
        e.createdAt = r.createdAt;
        e.requiresHost = r.requiresHost;
        e.license = r.license;
        e.sourceUrl = r.sourceUrl;
        e.changelogMarkdown = r.changelogMarkdown;
        e.rolloutPercent = r.rolloutPercent;
        e.artifacts.clear();
        if (r.artifacts != null) {
            for (Release.ArtifactInfo a : r.artifacts) {
                e.artifacts.add(new ReleaseEntity.ArtifactEmb(a.kind().name(),
                        a.platform().name(), a.arch().name(), a.variant(), a.filename(), a.size(), a.sha256(),
                        a.signature(), a.keyId(), a.blobKey(), a.mimeType()));
            }
        }
        e.dependencies.clear();
        if (r.dependencies != null) {
            for (Release.DependencyDecl d : r.dependencies) {
                e.dependencies.add(new ReleaseEntity.DependencyEmb(d.coordinate(), d.range(),
                        d.optional()));
            }
        }
        e.permissions.clear();
        if (r.permissions != null) {
            for (Release.PermissionDecl p : r.permissions) {
                e.permissions.add(new ReleaseEntity.PermissionEmb(p.permissionId(), p.scope(),
                        p.required(), p.reason()));
            }
        }
    }

    public static Release toDomain(ReleaseEntity e) {
        Release r = new Release();
        r.id = e.id;
        r.listingId = e.listingId;
        r.rowVersion = e.rowVersion;
        r.version = SemVer.parse(e.version);
        r.status = ReleaseStatus.valueOf(e.status);
        r.channel = Channel.valueOf(e.channel);
        r.publishedAt = e.publishedAt;
        r.createdAt = e.createdAt;
        r.requiresHost = e.requiresHost;
        r.license = e.license;
        r.sourceUrl = e.sourceUrl;
        r.changelogMarkdown = e.changelogMarkdown;
        r.rolloutPercent = e.rolloutPercent;
        r.artifacts = new ArrayList<>();
        for (ReleaseEntity.ArtifactEmb a : e.artifacts) {
            r.artifacts.add(new Release.ArtifactInfo(artifactId(e.id, a),
                    ArtifactKind.valueOf(a.kind()), Platform.valueOf(a.platform()),
                    Arch.valueOf(a.arch()), a.variant(), a.filename(), a.size(), a.sha256(), a.signature(),
                    a.keyId(), a.blobKey(), a.mimeType()));
        }
        r.dependencies = new ArrayList<>();
        for (ReleaseEntity.DependencyEmb d : e.dependencies) {
            r.dependencies.add(new Release.DependencyDecl(d.coordinate(), d.range(), d.optional()));
        }
        r.permissions = new ArrayList<>();
        for (ReleaseEntity.PermissionEmb p : e.permissions) {
            r.permissions.add(new Release.PermissionDecl(p.permissionId(), p.scope(), p.required(),
                    p.reason()));
        }
        return r;
    }

    /**
     * Element collections cannot carry a stable primary key, so artifact ids are
     * derived deterministically from the release-scoped routing tuple. This keeps
     * the ids advertised by listing details valid for artifactId-addressed
     * download tickets across repository reloads.
     */
    static UUID artifactId(UUID releaseId, ReleaseEntity.ArtifactEmb a) {
        String route = releaseId + ":" + a.kind() + ":" + a.platform() + ":" + a.arch() + ":"
                + a.variant() + ":" + a.filename();
        return UUID.nameUUIDFromBytes(route.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
}
