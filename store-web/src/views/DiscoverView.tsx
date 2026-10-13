import ArtifactTypeIcon from '../components/ArtifactTypeIcon';
import { useEffect, useMemo, useState, useId } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { AuroraBackground } from '../components/aceternity/aurora-background';
import { TextHoverEffect } from '../components/aceternity/text-hover-effect';
import { HoverBorderGradient } from '../components/aceternity/hover-border-gradient';
import { PinContainer } from '../components/aceternity/3d-pin';
import { Tabs } from '../components/aceternity/tabs';
import { CardSpotlight } from '../components/aceternity/card-spotlight';
import { InfiniteMovingCards } from '../components/aceternity/infinite-moving-cards';
import { AnimatedTooltip } from '../components/aceternity/animated-tooltip';
import { TracingBeam } from '../components/aceternity/tracing-beam';
import { BorderBeam } from '../components/aceternity/border-beam';
import { ShimmerButton } from '../components/aceternity/shimmer-button';
import { SparklesCore } from '../components/aceternity/sparkles';
import { SearchIcon } from '../components/aceternity/icons';
import { api, type CatalogItem, type CatalogPage } from '../api/client';
import { formatNumber } from '../utils/format';
import LoadingGrid from '../components/LoadingGrid';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';

const TYPES = ['APP', 'PLUGIN', 'SKILL', 'MCP', 'FLOW'] as const;
type TypeKey = (typeof TYPES)[number];

const TYPE_COLORS: Record<TypeKey, string> = {
  APP: '#0b70f5',
  PLUGIN: '#21d789',
  SKILL: '#fc801d',
  MCP: '#a73afd',
  FLOW: '#fe2857',
};

/** Brand hex tile used wherever a listing has no iconUrl. */
function HexArt({ item, className }: { item: CatalogItem; className?: string }) {
  const id = useId();
  const from = TYPE_COLORS[item.type as TypeKey] ?? '#a73afd';
  const to = '#0b70f5';
  return (
    <div
      className={`relative grid place-items-center overflow-hidden ${className ?? ''}`}
      style={{ background: `linear-gradient(135deg, ${from}26, ${to}26), #0a0a0c` }}
    >
      <div className="absolute inset-0 bg-hex-grid opacity-60" />
      <svg viewBox="0 0 32 32" fill="none" className="relative size-8">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <path
          d="M16 2.5 27.5 9v14L16 29.5 4.5 23V9L16 2.5Z"
          stroke={`url(#${id})`}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="16" r="4" fill={`url(#${id})`} />
      </svg>
    </div>
  );
}

export default function DiscoverView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [totalListings, setTotalListings] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // The catalog section IS the full listing browser on this page, so pull
      // the whole index via keyset pagination (API caps a single page at 100).
      const collected: CatalogItem[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const qs = new URLSearchParams({ limit: '100', sort: 'downloads' });
        if (cursor) qs.set('cursor', cursor);
        const pageData = await api.get<CatalogPage>(`/api/v1/catalog?${qs.toString()}`);
        const batch = pageData.items ?? [];
        collected.push(...batch);
        cursor = pageData.nextCursor ?? undefined;
        if (!cursor || batch.length === 0) break;
      }
      setItems(collected);
      setTotalListings(collected.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  // Self-dark page: swap the viewport scrollbar to the dark rail while mounted
  // (same mechanism the intro page uses with .introduction-scrollbar).
  useEffect(() => {
    document.documentElement.classList.add('dark-page-scrollbar');
    return () => document.documentElement.classList.remove('dark-page-scrollbar');
  }, []);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    navigate({ pathname: '/store/browse', search: searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : '' });
  }

  function scrollToCatalog() {
    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const totalDownloads = useMemo(() => items.reduce((sum, i) => sum + (i.downloads ?? 0), 0), [items]);
  const featured = useMemo(
    () => (items.some((i) => i.featured) ? items.filter((i) => i.featured).slice(0, 5) : items.slice(0, 5)),
    [items],
  );
  const publishers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) {
      if (!i.publisherName) continue;
      counts.set(i.publisherName, (counts.get(i.publisherName) ?? 0) + 1);
    }
    return [...counts.entries()].slice(0, 8).map(([name, count], i) => ({
      id: i + 1,
      name,
      designation: `${count} ${t('discover.statsListings')}`,
    }));
  }, [items, t]);

  const catalogTabs = useMemo(
    () => [
      { title: t('common.viewAll'), value: 'all', content: <CatalogGrid items={items} /> },
      ...TYPES.map((type) => ({
        title: t(`type.${type}`),
        value: type,
        content: <CatalogGrid items={items.filter((i) => i.type === type)} />,
      })),
    ],
    [items, t],
  );

  return (
    <div className="dark min-h-screen overflow-x-clip bg-black text-white">
      {/* ── Hero: aurora wash + hover-reveal display type + search ── */}
      <AuroraBackground className="min-h-[88vh] bg-black text-white dark:bg-black">
        <section className="relative z-10 mx-auto flex min-h-[88vh] max-w-7xl flex-col items-center justify-center px-6 pb-20 pt-36 text-center">
          <div className="h-36 w-full max-w-2xl opacity-90 sm:h-44">
            <TextHoverEffect text="INFINIA" duration={0.35} />
          </div>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.4em] text-white/40">
            Fengyu Store
          </p>
          <h1 className="mt-6 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {t('discover.heroTitle')}
          </h1>
          <p className="mt-4 max-w-xl text-pretty leading-7 text-white/55">
            {t('discover.heroSubtitle')}
          </p>

          <form role="search" className="mt-10 flex w-full max-w-xl items-center gap-3" onSubmit={submitSearch}>
            <label className="relative flex h-13 w-full items-center rounded-full border border-white/15 bg-black/60 pl-12 backdrop-blur transition-colors focus-within:border-jb-purple/60">
              <SearchIcon className="absolute left-4 size-5 text-white/40" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                type="search"
                placeholder={t('common.search')}
                aria-label={t('common.search')}
                className="h-full w-full bg-transparent pr-4 text-sm text-white placeholder:text-white/35 focus:outline-none"
              />
            </label>
            <HoverBorderGradient
              containerClassName="rounded-full shrink-0"
              as="button"
              className="flex h-13 items-center gap-2 bg-black px-6 text-sm font-semibold text-white"
            >
              {t('common.searchAction')}
            </HoverBorderGradient>
          </form>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {TYPES.map((type, i) => (
              <HoverBorderGradient
                key={type}
                as={Link}
                to={`/store/browse?type=${type}`}
                containerClassName="rounded-full"
                className="flex items-center gap-2 bg-black px-4 py-2 text-xs font-medium text-white/80"
                duration={1.5}
                clockwise={i % 2 === 0}
              >
                <span className="flex items-center gap-2" style={{ color: TYPE_COLORS[type] }}>
                  <ArtifactTypeIcon type={type} className="size-4" />
                  {t(`type.${type}`)}
                </span>
              </HoverBorderGradient>
            ))}
          </div>

          <div className="mt-14 flex items-center justify-center gap-12">
            {[
              { v: totalListings.toLocaleString(), label: t('discover.statsListings') },
              { v: totalDownloads.toLocaleString(), label: t('discover.statsDownloads') },
              { v: String(TYPES.length), label: t('discover.statsTypes') },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="font-display text-2xl font-bold text-white sm:text-3xl">{s.v}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </section>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-36 bg-gradient-to-b from-transparent to-black" />
      </AuroraBackground>

      {error ? (
        <div className="mx-auto max-w-7xl px-6 py-24">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : (
        <>
          {/* ── Featured: editor's pick, one calm wide card ── */}
          <section id="featured" className="mx-auto max-w-6xl px-6 py-20">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6 }}
            >
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-jb-purple">
                    {'//'} {t('discover.featuredEyebrow')}
                  </p>
                  <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
                    {t('discover.featuredLead')}{' '}
                    <span className="text-jb-green">{featured[0]?.name ?? ''}</span>
                  </h2>
                </div>
              </div>
              {loading ? <LoadingGrid /> : featured[0] ? <FeaturedCard item={featured[0]} /> : <EmptyState title={t('discover.noFeatured')} />}
            </motion.div>
          </section>

          {/* ── Hot trio: 3D pins ── */}
          {!loading && featured.length >= 3 && (
            <section className="mx-auto max-w-6xl px-6 pb-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-jb-purple">
                    {'//'} {t('discover.hot')}
                  </p>
                  <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
                    {t('discover.hotTitle')}
                  </h2>
                </div>
              </div>
              <div className="mt-6 grid gap-6 sm:grid-cols-3">
                {featured.slice(0, 3).map((item) => (
                  <div key={item.coordinate} className="flex justify-center">
                    <PinContainer
                      title={`${item.namespace} · ↓ ${formatNumber(item.downloads ?? 0)}`}
                      href={`/store/listing/${item.namespace}/${item.slug}`}
                      containerClassName="h-[21rem] w-72"
                    >
                      <PinCard item={item} />
                    </PinContainer>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Catalog: the full listing browser (all items, tabbed by type) ── */}
          <section id="catalog" className="mx-auto max-w-7xl scroll-mt-24 px-6 py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-jb-purple">
                  {'//'} {t('discover.catalogEyebrow')}
                </p>
                <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
                  {t('discover.catalogTitle')}
                </h2>
              </div>
              <Link
                to="/store/browse"
                className="text-sm text-white/50 transition-colors hover:text-white"
              >
                {t('discover.advancedFilter')} →
              </Link>
            </div>
            <div className="mt-10">
              {loading ? <LoadingGrid /> : <Tabs tabs={catalogTabs} contentClassName="mt-10" activeTabClassName="bg-white/10" />}
            </div>
          </section>

          {/* ── Trending marquee ── */}
          {!loading && items.length > 0 && (
            <section className="py-20">
              <div className="mx-auto max-w-7xl px-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-jb-purple">
                  {'//'} {t('discover.trendingEyebrow')}
                </p>
                <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
                  {t('discover.trendingTitle')}
                </h2>
              </div>
              <div className="mt-10">
                <InfiniteMovingCards
                  items={items.map((l) => ({
                    quote: l.summary ?? l.name,
                    name: l.name,
                    title: `${t(`type.${l.type}`)} · ↓ ${formatNumber(l.downloads ?? 0)}`,
                  }))}
                  className="w-full max-w-none"
                  direction="right"
                  speed="slow"
                  pauseOnHover
                />
              </div>
            </section>
          )}

          {/* ── Publishers ── */}
          {!loading && publishers.length >= 2 && (
            <section className="mx-auto max-w-7xl px-6 py-10">
              <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-10">
                <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-jb-purple">
                      {'//'} {t('discover.publishersEyebrow')}
                    </p>
                    <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
                      {t('discover.publishersTitle')}
                    </h2>
                  </div>
                  <AnimatedTooltip items={publishers} />
                </div>
              </div>
            </section>
          )}

          {/* ── Install flow ── */}
          <section className="mx-auto max-w-7xl px-6 py-20">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-jb-purple">
              {'//'} {t('discover.installEyebrow')}
            </p>
            <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
              {t('discover.installTitle')}
            </h2>
            <div className="mt-6">
              <TracingBeam className="px-2 md:px-10">
                <div className="mx-auto max-w-3xl">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="py-8">
                      <p className="font-mono text-sm font-semibold text-jb-purple">{`0${n}`}</p>
                      <h3 className="mt-2 font-display text-xl font-semibold text-white">
                        {t(`discover.install${n}Title`)}
                      </h3>
                      <p className="mt-2 max-w-xl text-sm leading-7 text-white/55">
                        {t(`discover.install${n}Body`)}
                      </p>
                    </div>
                  ))}
                </div>
              </TracingBeam>
            </div>
          </section>
        </>
      )}

      {/* ── CTA ── */}
      <section className="relative overflow-hidden py-32">
        <div className="absolute inset-x-0 top-0 h-40 [mask-image:linear-gradient(to_bottom,black,transparent)]">
          <SparklesCore
            id="store-cta-sparkles"
            background="transparent"
            minSize={0.4}
            maxSize={1}
            particleDensity={60}
            className="h-full w-full"
            particleColor="#a73afd"
          />
        </div>
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
            {t('discover.ctaTitle')}{' '}
            <span className="bg-gradient-to-r from-jb-purple to-jb-blue bg-clip-text text-transparent">
              {t('discover.ctaTitleAccent')}
            </span>
          </h2>
          <p className="mt-5 text-white/55">{t('discover.ctaBody')}</p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <ShimmerButton
              onClick={scrollToCatalog}
              shimmerColor="rgba(246,189,96,0.85)"
              className="text-base"
            >
              {t('discover.ctaBrowse')}
            </ShimmerButton>
            <Link
              to="/"
              className="flex h-12 items-center rounded-full border border-white/20 px-8 text-sm font-semibold text-white/85 transition-colors hover:border-white/50"
            >
              {t('discover.ctaHome')}
            </Link>
          </div>
        </div>
      </section>

      {/* Dark footer matching the discover page's Aceternity language. */}
      <footer className="border-t border-white/10 bg-black">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-xs text-white/45">
          <p>
            {t('common.footerTagline')}
            <span aria-hidden="true">·</span>
            <Link to="/store/status" className="ml-1 text-white/70 transition-colors hover:text-white">
              {t('nav.status')}
            </Link>
          </p>
          <Link to="/store" className="flex items-center gap-2">
            <img src="/infinia-logo.svg" alt="" className="h-6 w-6" />
            <span className="font-semibold text-white">Infinia Store</span>
          </Link>
        </div>
      </footer>
    </div>
  );
}

function CatalogGrid({ items }: { items: CatalogItem[] }) {
  const { t } = useTranslation();
  if (!items.length) return <EmptyState title={t('discover.noLatest')} />;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <CardSpotlight
          key={item.coordinate}
          color={TYPE_COLORS[item.type as TypeKey] ?? '#a73afd'}
          radius={260}
          className="rounded-2xl p-6"
        >
          <Link
            to={`/store/listing/${item.namespace}/${item.slug}`}
            className="flex flex-col gap-3"
          >
            <div className="flex items-center gap-3">
              {item.iconUrl ? (
                <img src={item.iconUrl} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
              ) : (
                <HexArt item={item} className="size-12 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="truncate font-display text-base font-semibold text-white">{item.name}</p>
                <p className="truncate font-mono text-[11px] text-white/40">{item.namespace}</p>
              </div>
              {item.channel && item.channel !== 'stable' && (
                <span className="ml-auto shrink-0 rounded-full border border-jb-orange/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-jb-orange">
                  {t(`channel.${item.channel}`)}
                </span>
              )}
            </div>
            <p className="line-clamp-2 min-h-10 text-sm leading-6 text-white/50">{item.summary}</p>
            <div className="flex items-center justify-between border-t border-white/10 pt-3 font-mono text-[11px] text-white/45">
              <span style={{ color: TYPE_COLORS[item.type as TypeKey] }}>{t(`type.${item.type}`)}</span>
              {item.latestVersion && <span>v{item.latestVersion}</span>}
              <span>↓ {formatNumber(item.downloads ?? 0)}</span>
            </div>
          </Link>
        </CardSpotlight>
      ))}
    </div>
  );
}

function PinCard({ item }: { item: CatalogItem }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-64 flex-col gap-3">
      {item.iconUrl ? (
        <img src={item.iconUrl} alt="" className="h-32 w-full rounded-xl object-cover" />
      ) : (
        <HexArt item={item} className="h-32 w-full" />
      )}
      <div className="flex items-center justify-between">
        <span
          className="whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest"
          style={{
            borderColor: `${TYPE_COLORS[item.type as TypeKey] ?? '#a73afd'}66`,
            color: TYPE_COLORS[item.type as TypeKey],
          }}
        >
          {t(`type.${item.type}`)}
        </span>
        <span className="font-mono text-[10px] text-white/40">
          ↓ {formatNumber(item.downloads ?? 0)}
        </span>
      </div>
      <p className="font-display text-lg font-semibold leading-tight text-white">{item.name}</p>
      <p className="line-clamp-2 text-xs leading-5 text-white/45">{item.summary}</p>
    </div>
  );
}

function FeaturedCard({ item }: { item: CatalogItem }) {
  const { t } = useTranslation();
  return (
    <div className="relative mt-8 grid overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] md:grid-cols-[1fr_1.2fr]">
      <BorderBeam size={64} borderRadius={24} duration={9} colorFrom="#a73afd" colorTo="#0b70f5" />
      {item.iconUrl ? (
        <img src={item.iconUrl} alt="" className="min-h-56 w-full object-cover md:min-h-full" />
      ) : (
        <HexArt item={item} className="min-h-56 w-full rounded-none md:min-h-full" />
      )}
      <div className="flex flex-col justify-center gap-4 p-8 md:p-10">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap rounded-full border border-jb-green/40 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-jb-green">
            {t(`type.${item.type}`)}
          </span>
          {item.channel && item.channel !== 'stable' && (
            <span className="whitespace-nowrap rounded-full border border-jb-orange/40 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-jb-orange">
              {t(`channel.${item.channel}`)}
            </span>
          )}
          <span className="font-mono text-[11px] text-white/40">↓ {formatNumber(item.downloads ?? 0)}</span>
        </div>
        <h3 className="font-display text-2xl font-bold text-white">{item.name}</h3>
        <p className="font-mono text-xs text-white/40">{item.namespace}</p>
        <p className="text-sm leading-7 text-white/60">{item.summary}</p>
        <div className="flex flex-wrap gap-2">
          {(item.tags ?? []).slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-[10px] text-white/50"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="mt-2 inline-flex w-fit rounded-xl bg-[linear-gradient(90deg,#f6bd60,#eab04b)] p-px">
          <Link
            to={`/store/listing/${item.namespace}/${item.slug}`}
            className="flex items-center gap-2 rounded-[11px] bg-neutral-950 px-6 py-3 text-sm font-semibold text-white"
          >
            {t('listing.overview')} →
          </Link>
        </div>
      </div>
    </div>
  );
}
