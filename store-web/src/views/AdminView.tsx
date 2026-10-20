import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  api,
  formatFen,
  type AdminAppRelease,
  type AdminAppUploadSession,
  type AdminListing,
  type AdminMembershipOrder,
  type AdminMembershipPlan,
  type AdminUser,
  type AuditEvent,
  type DataSourceStatus,
  type InvitationCode,
  type PublisherRelease,
  type RegistrationPolicy,
  type RemoteDatabase,
  type RemoteDatabaseTestResult,
  type Report,
  type Upstream,
  type UpstreamSyncRun,
} from '../api/client';
import { BlurFade } from '../components/magicui/blur-fade';
import HexWash from '../components/HexWash';
import { Badge } from '@/components/ui/badge';
import BeeLevelBadge from '../components/BeeLevelBadge';
import EmptyState from '../components/EmptyState';
import LoadingGrid from '../components/LoadingGrid';
import ErrorState from '../components/ErrorState';
import StateChip from '../components/StateChip';
import SelectMenu from '../components/SelectMenu';
import UserRolesEditor from '../components/UserRolesEditor';
import { useAuth, patchUser } from '../stores/auth';
import { formatDate, formatDateTime } from '../utils/format';
import { badgeToneClass, badgeBaseClass } from '../utils/badgeTone';
import { cn } from '@/lib/utils';

/**
 * Platform admin console (design §12.4 管理): user management (Infinia Level),
 * listing curation incl. Infinia Level gates, abuse report queue, security
 * withdrawals (yank / quarantine by release id) and the global audit trail.
 * Review decisions stay in the reviewer queue.
 */

type AdminTab =
  | 'users'
  | 'membership'
  | 'invitations'
  | 'databases'
  | 'upstreams'
  | 'listings'
  | 'reports'
  | 'appRelease'
  | 'withdraw'
  | 'audit';

/**
 * Grouped navigation (design §12.4 管理): eight flat tabs read as one noisy
 * row, so the console is organized into four labeled sections — people,
 * catalog supply, trust & safety, infrastructure.
 */
const NAV_GROUPS: { labelKey: string; items: AdminTab[] }[] = [
  { labelKey: 'admin.group.users', items: ['users', 'membership', 'invitations'] },
  {
    labelKey: 'admin.group.content',
    items: ['listings', 'upstreams', 'appRelease'],
  },
  { labelKey: 'admin.group.trust', items: ['reports', 'withdraw', 'audit'] },
  { labelKey: 'admin.group.system', items: ['databases'] },
];

const BEE_LEVELS = [0, 1, 2, 3, 4];
/** Editable draft for the create row; levels 1-4 only (LARVA is not for sale). */
const PURCHASABLE_LEVELS = [1, 2, 3, 4];

export default function AdminView() {
  const auth = useAuth();
  const { t } = useTranslation();

  const [tab, setTab] = useState<AdminTab>('users');

  // ---- remote databases (远程数据库配置) ----
  const [databases, setDatabases] = useState<RemoteDatabase[]>([]);
  const [dataSourceStatus, setDataSourceStatus] =
    useState<DataSourceStatus | null>(null);
  const [databasesLoading, setDatabasesLoading] = useState(false);
  const [databasesError, setDatabasesError] = useState<string | null>(null);
  const [dbBusyId, setDbBusyId] = useState<string | null>(null);
  const [lastProbe, setLastProbe] = useState<RemoteDatabaseTestResult | null>(
    null,
  );
  const [newDb, setNewDb] = useState({
    name: '',
    jdbcUrl: '',
    username: '',
    password: '',
  });
  const [addingDb, setAddingDb] = useState(false);

  async function loadDatabases() {
    setDatabasesLoading(true);
    setDatabasesError(null);
    try {
      const [rows, status] = await Promise.all([
        api.getRemoteDatabases(),
        api.getDataSourceStatus(),
      ]);
      setDatabases(rows);
      setDataSourceStatus(status);
    } catch (e) {
      setDatabasesError(e instanceof Error ? e.message : String(e));
    } finally {
      setDatabasesLoading(false);
    }
  }

  async function addDatabase(event: React.FormEvent) {
    event.preventDefault();
    if (!newDb.name || !newDb.jdbcUrl || !newDb.username || !newDb.password) {
      return;
    }
    setAddingDb(true);
    setDatabasesError(null);
    try {
      await api.createRemoteDatabase({ ...newDb });
      setNewDb({ name: '', jdbcUrl: '', username: '', password: '' });
      await loadDatabases();
    } catch (e) {
      setDatabasesError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingDb(false);
    }
  }

  async function probeDatabase(row: RemoteDatabase) {
    setDbBusyId(row.databaseId);
    setDatabasesError(null);
    setLastProbe(null);
    try {
      setLastProbe(await api.testRemoteDatabase(row.databaseId));
      await loadDatabases();
    } catch (e) {
      setDatabasesError(e instanceof Error ? e.message : String(e));
    } finally {
      setDbBusyId(null);
    }
  }

  async function toggleActivation(row: RemoteDatabase) {
    setDbBusyId(row.databaseId);
    setDatabasesError(null);
    try {
      await api.setRemoteDatabaseActivation(row.databaseId, !row.enabled);
      await loadDatabases();
    } catch (e) {
      setDatabasesError(e instanceof Error ? e.message : String(e));
      await loadDatabases();
    } finally {
      setDbBusyId(null);
    }
  }

  async function removeDatabase(row: RemoteDatabase) {
    setDbBusyId(row.databaseId);
    setDatabasesError(null);
    try {
      await api.deleteRemoteDatabase(row.databaseId);
      await loadDatabases();
    } catch (e) {
      setDatabasesError(e instanceof Error ? e.message : String(e));
    } finally {
      setDbBusyId(null);
    }
  }

  // ---- user management (Infinia Level · 用户管理) ----
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');

  function beeLevelLabel(level: number, suffix = ''): string {
    return `${t(`beeLevel.${level}`)} · Lv${level}${suffix}`;
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return q
      ? users.filter(
          (u) =>
            u.email.toLowerCase().includes(q) ||
            (u.displayName ?? '').toLowerCase().includes(q),
        )
      : [...users];
  }, [users, userSearch]);

  async function loadUsers() {
    setUsersLoading(true);
    setUsersError(null);
    try {
      setUsers(await api.getAdminUsers());
    } catch (e) {
      setUsersError(e instanceof Error ? e.message : String(e));
    } finally {
      setUsersLoading(false);
    }
  }

  async function setUserBeeLevel(user: AdminUser, level: number) {
    if (level === user.beeLevel) return;
    setSavingUserId(user.userId);
    setUsersError(null);
    try {
      const updated = await api.updateAdminUser(user.userId, {
        beeLevel: level,
      });
      setUsers((current) =>
        current.map((u) =>
          u.userId === user.userId ? { ...u, ...updated } : u,
        ),
      );
    } catch (e) {
      setUsersError(e instanceof Error ? e.message : String(e));
      await loadUsers();
    } finally {
      setSavingUserId(null);
    }
  }

  async function toggleUserStatus(user: AdminUser) {
    setSavingUserId(user.userId);
    setUsersError(null);
    try {
      const updated = await api.updateAdminUser(user.userId, {
        status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
      });
      setUsers((current) =>
        current.map((u) =>
          u.userId === user.userId ? { ...u, ...updated } : u,
        ),
      );
    } catch (e) {
      setUsersError(e instanceof Error ? e.message : String(e));
      await loadUsers();
    } finally {
      setSavingUserId(null);
    }
  }

  // ---- membership plans & orders (管理 · 会员套餐) ----
  const [membershipPlans, setMembershipPlans] = useState<AdminMembershipPlan[]>(
    [],
  );
  const [membershipOrders, setMembershipOrders] = useState<
    AdminMembershipOrder[]
  >([]);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [newPlan, setNewPlan] = useState({
    beeLevel: 1,
    durationDays: 30,
    priceFen: 600,
    sort: 1,
    externalUrl: '',
  });

  async function loadMembership() {
    setMembershipLoading(true);
    setMembershipError(null);
    try {
      const [plans, orders] = await Promise.all([
        api.getAdminMembershipPlans(),
        api.getAdminMembershipOrders(),
      ]);
      setMembershipPlans(plans);
      setMembershipOrders(orders);
    } catch (e) {
      setMembershipError(e instanceof Error ? e.message : String(e));
    } finally {
      setMembershipLoading(false);
    }
  }

  /** The create form works in yuan for readability; the API speaks fen. */
  const newPlanYuan = (newPlan.priceFen / 100).toString();

  async function addPlan(event: React.FormEvent) {
    event.preventDefault();
    setMembershipError(null);
    try {
      await api.createAdminMembershipPlan({ ...newPlan });
      await loadMembership();
    } catch (e) {
      setMembershipError(e instanceof Error ? e.message : String(e));
    }
  }

  async function updatePlan(
    plan: AdminMembershipPlan,
    body: Partial<Omit<AdminMembershipPlan, 'externalUrl'>> & {
      externalUrl?: string;
    },
  ) {
    setBusyPlanId(plan.planId);
    setMembershipError(null);
    try {
      const updated = await api.updateAdminMembershipPlan(plan.planId, {
        beeLevel: body.beeLevel ?? plan.beeLevel,
        durationDays: body.durationDays ?? plan.durationDays,
        priceFen: body.priceFen ?? plan.priceFen,
        active: body.active ?? plan.active,
        sort: body.sort ?? plan.sort,
        // Blank clears the link; undefined keeps the stored one (partial update).
        externalUrl:
          body.externalUrl !== undefined
            ? body.externalUrl
            : (plan.externalUrl ?? ''),
      });
      setMembershipPlans((current) =>
        current.map((p) =>
          p.planId === plan.planId ? { ...p, ...updated } : p,
        ),
      );
    } catch (e) {
      setMembershipError(e instanceof Error ? e.message : String(e));
      await loadMembership();
    } finally {
      setBusyPlanId(null);
    }
  }

  async function removePlan(plan: AdminMembershipPlan) {
    if (
      !window.confirm(
        t('admin.membershipDeleteConfirm', {
          level: plan.beeLevel,
          n: plan.durationDays,
        }),
      )
    ) {
      return;
    }
    setBusyPlanId(plan.planId);
    setMembershipError(null);
    try {
      await api.deleteAdminMembershipPlan(plan.planId);
      await loadMembership();
    } catch (e) {
      setMembershipError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyPlanId(null);
    }
  }

  function membershipOrderTone(status: string): 'success' | 'muted' | 'gold' {
    if (status === 'PAID') return 'success';
    if (status === 'PENDING') return 'gold';
    return 'muted';
  }

  // ---- invitation console (管理 · 邀请码): switch + unlimited issuance ----
  const [adminInvitations, setAdminInvitations] = useState<InvitationCode[]>(
    [],
  );
  const [registrationPolicy, setRegistrationPolicy] =
    useState<RegistrationPolicy | null>(null);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  const [switchingPolicy, setSwitchingPolicy] = useState(false);
  const [issuingAdminCode, setIssuingAdminCode] = useState(false);
  const [lastIssuedCode, setLastIssuedCode] = useState<InvitationCode | null>(
    null,
  );

  async function loadInvitations() {
    setInvitationsLoading(true);
    setInvitationsError(null);
    try {
      const [codes, policy] = await Promise.all([
        api.getAdminInvitations(),
        api.getAdminRegistrationPolicy(),
      ]);
      setAdminInvitations(codes);
      setRegistrationPolicy(policy);
    } catch (e) {
      setInvitationsError(e instanceof Error ? e.message : String(e));
    } finally {
      setInvitationsLoading(false);
    }
  }

  async function toggleRegistrationPolicy() {
    if (!registrationPolicy || switchingPolicy) return;
    setSwitchingPolicy(true);
    setInvitationsError(null);
    try {
      setRegistrationPolicy(
        await api.setAdminRegistrationPolicy(
          !registrationPolicy.invitationRequired,
        ),
      );
    } catch (e) {
      setInvitationsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitchingPolicy(false);
    }
  }

  /** No level gate, no monthly limit — the admin path exists precisely so
   * operators can hand out codes beyond any member quota. */
  async function issueAdminInvitation() {
    if (issuingAdminCode) return;
    setIssuingAdminCode(true);
    setInvitationsError(null);
    try {
      const code = await api.createAdminInvitation();
      setLastIssuedCode(code);
      await loadInvitations();
    } catch (e) {
      setInvitationsError(e instanceof Error ? e.message : String(e));
    } finally {
      setIssuingAdminCode(false);
    }
  }

  // ---- upstream aggregation (aggregation plan §3/§8) ----
  const [upstreams, setUpstreams] = useState<Upstream[]>([]);
  const [upstreamsLoading, setUpstreamsLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newNamespace, setNewNamespace] = useState('');
  const [newAdapter, setNewAdapter] = useState('AUTO');
  const [adding, setAdding] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  /** Sync-log viewer: which source is open and its recent runs. */
  const [logUpstream, setLogUpstream] = useState<Upstream | null>(null);
  const [logRuns, setLogRuns] = useState<UpstreamSyncRun[] | null>(null);
  const [logLoading, setLogLoading] = useState(false);

  async function loadUpstreams() {
    setUpstreamsLoading(true);
    try {
      setUpstreams(await api.getUpstreams());
    } finally {
      setUpstreamsLoading(false);
    }
  }

  /**
   * Registration opens a background run server-side, so the list already shows
   * the new source with 正在同步; the poll settles it into 成功/失败 without
   * the admin babysitting a request that takes minutes.
   */
  async function addUpstream(event: React.FormEvent) {
    event.preventDefault();
    if (!newName || !newUrl || !newNamespace) return;
    setAdding(true);
    setError(null);
    try {
      await api.createUpstream({
        name: newName,
        marketplaceUrl: newUrl,
        targetNamespace: newNamespace,
        adapterType: newAdapter,
      });
      setNewName('');
      setNewUrl('');
      setNewNamespace('');
      await loadUpstreams();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  async function syncNow(row: Upstream) {
    setSyncingId(row.upstreamId);
    setError(null);
    try {
      await api.syncUpstream(row.upstreamId);
      await Promise.all([loadUpstreams(), loadAdminListings()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingId(null);
    }
  }

  async function openSyncLog(row: Upstream) {
    setLogUpstream(row);
    setLogRuns(null);
    setLogLoading(true);
    try {
      setLogRuns(await api.getUpstreamSyncRuns(row.upstreamId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLogUpstream(null);
    } finally {
      setLogLoading(false);
    }
  }

  function closeSyncLog() {
    setLogUpstream(null);
    setLogRuns(null);
  }

  function runStatusTone(
    status?: string | null,
  ): 'success' | 'danger' | 'muted' {
    if (status === 'OK') return 'success';
    if (status === 'PARTIAL') return 'danger';
    return 'muted';
  }

  function runStatusLabel(status?: string | null): string {
    if (status === 'RUNNING') return t('admin.syncSyncing');
    if (status === 'OK') return t('admin.runOk');
    if (status === 'PARTIAL') return t('admin.runPartial');
    return status ?? '—';
  }

  // ---- listing curation (design §12.4 管理: 上下架/推荐/Infinia Level 门槛) ----
  const [adminListings, setAdminListings] = useState<AdminListing[]>([]);
  // Starts true: the mount effect fetches unconditionally, and a false initial
  // value paints an "empty" table for a frame before the request registers —
  // the "UI shows before data arrives" flash.
  const [listingsLoading, setListingsLoading] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [listingSearch, setListingSearch] = useState('');
  const [listingsCursor, setListingsCursor] = useState<string | null>(null);
  const [listingsTotal, setListingsTotal] = useState(0);

  /** Instant local narrowing of what is loaded; the debounced server query
   * below is the one that scales — its predicate runs in SQL now, because the
   * old load-everything console froze whole catalogs into the page. */
  const filteredListings = useMemo(() => {
    const q = listingSearch.trim().toLowerCase();
    if (!q) return adminListings;
    return adminListings.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.coordinate.toLowerCase().includes(q),
    );
  }, [adminListings, listingSearch]);

  /** Loads a page of the curation console. append=true continues from the
   * cursor (the "load more" control); a fresh load always restarts at page 1
   * of the current search term. */
  async function loadAdminListings(append = false) {
    setListingsLoading(true);
    setListingsError(null);
    try {
      const page = await api.getAdminListings({
        query: listingSearch.trim() || undefined,
        after: append && listingsCursor ? listingsCursor : undefined,
      });
      setListingsCursor(page.nextCursor);
      setListingsTotal(page.totalEstimate);
      setAdminListings((current) =>
        append
          ? [
              ...current.filter(
                (l) => !page.items.some((p) => p.listingId === l.listingId),
              ),
              ...page.items,
            ]
          : page.items,
      );
    } catch (e) {
      // A failed fetch must not read as "no listings": the old silent path
      // rendered an empty table whenever the request died (proxy timeout,
      // network drop) — indistinguishable from an actually empty catalog.
      setListingsError(e instanceof Error ? e.message : String(e));
    } finally {
      setListingsLoading(false);
    }
  }

  // Server-side search with a debounce: each keystroke is free (local filter
  // above), and one SQL-pushed request lands shortly after typing stops. The
  // mount effect in this component performs the initial page load, so the
  // first run here is skipped.
  const listingSearchInitialized = useRef(false);
  useEffect(() => {
    if (!listingSearchInitialized.current) {
      listingSearchInitialized.current = true;
      return;
    }
    const handle = setTimeout(() => void loadAdminListings(), 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingSearch]);

  async function toggleVisibility(row: AdminListing) {
    // Delisting hides the listing from every catalog at once — worth a confirm.
    const delisting = row.visibility === 'PUBLIC';
    if (
      delisting &&
      !window.confirm(t('admin.delistConfirm', { name: row.name }))
    )
      return;
    const visibility = delisting ? 'UNLISTED' : 'PUBLIC';
    try {
      const updated = await api.post<AdminListing>(
        `/api/v1/admin/listings/${row.listingId}/visibility`,
        { visibility },
      );
      setAdminListings((current) =>
        current.map((l) =>
          l.listingId === row.listingId ? { ...l, ...updated } : l,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleFeatured(row: AdminListing) {
    const updated = await api.post<AdminListing>(
      `/api/v1/admin/listings/${row.listingId}/featured`,
      { featured: !row.featured },
    );
    setAdminListings((current) =>
      current.map((l) =>
        l.listingId === row.listingId ? { ...l, ...updated } : l,
      ),
    );
  }

  async function setListingLevel(row: AdminListing, level: number) {
    if (level === row.minBeeLevel) return;
    const updated = await api.setListingMinBeeLevel(row.listingId, level);
    setAdminListings((current) =>
      current.map((l) =>
        l.listingId === row.listingId ? { ...l, ...updated } : l,
      ),
    );
  }

  const [reports, setReports] = useState<Report[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  function listingRoute(coordinate: string) {
    const parts = coordinate.replace('infinia://', '').split('/');
    return parts.length >= 3 ? `/store/listing/${parts[1]}/${parts[2]}` : '/store/browse';
  }

  const [releaseId, setReleaseId] = useState('');
  const [reason, setReason] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [r, a] = await Promise.all([
        api.get<Report[]>('/api/v1/admin/reports?status=OPEN'),
        api.get<AuditEvent[]>('/api/v1/admin/audit-events?limit=100'),
      ]);
      setReports(r);
      setAuditEvents(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadUsers();
    void loadDatabases();
    void loadAdminListings();
    void loadUpstreams();
    void loadAppReleases();
    void loadMembership();
    void loadInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resolve(report: Report, resolution: 'ACTIONED' | 'DISMISSED') {
    await api.post(`/api/v1/admin/reports/${report.reportId}/resolution`, {
      resolution,
      note: notes[report.reportId ?? ''] ?? '',
    });
    await load();
  }

  // ---- security withdrawal (安全下架): pick listing → pick release → act ----
  const [withdrawListingId, setWithdrawListingId] = useState('');
  const [withdrawReleases, setWithdrawReleases] = useState<PublisherRelease[]>(
    [],
  );
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawMessage, setWithdrawMessage] = useState('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawOptions, setWithdrawOptions] = useState<AdminListing[]>([]);
  const [withdrawSearch, setWithdrawSearch] = useState('');

  /** The picker feeds from the paged admin search — a dropdown enumerating
   * every listing was both frozen-slow and unusable past a few hundred rows,
   * so the admin narrows by name first. */
  useEffect(() => {
    const handle = setTimeout(() => {
      api
        .getAdminListings({ query: withdrawSearch.trim() || undefined })
        .then((page) => setWithdrawOptions(page.items))
        .catch(() => setWithdrawOptions([]));
    }, 400);
    return () => clearTimeout(handle);
  }, [withdrawSearch]);

  const WITHDRAW_LISTING_OPTIONS = withdrawOptions.map((l) => ({
    value: l.listingId,
    label: l.name,
  }));

  /** Admins may read every listing's releases (owner check is skipped for
   * PLATFORM_ADMIN), so the withdrawal form can offer versions by name. */
  async function loadWithdrawReleases() {
    setWithdrawError(null);
    setWithdrawMessage('');
    setWithdrawReleases([]);
    setReleaseId('');
    if (!withdrawListingId) return;
    setWithdrawLoading(true);
    try {
      setWithdrawReleases(
        await api.get<PublisherRelease[]>(
          `/api/v1/publisher/listings/${withdrawListingId}/releases`,
        ),
      );
    } catch (e) {
      setWithdrawError(e instanceof Error ? e.message : String(e));
    } finally {
      setWithdrawLoading(false);
    }
  }

  const WITHDRAW_RELEASE_OPTIONS = withdrawReleases.map((r) => ({
    value: r.releaseId,
    label: `v${r.version} · ${t(`state.${r.status}`, { defaultValue: r.status })}`,
  }));

  function onWithdrawListingChange(value: string | number) {
    setWithdrawListingId(String(value));
    void loadWithdrawReleases();
  }

  function onWithdrawReleaseChange(value: string | number) {
    setReleaseId(String(value));
  }

  async function withdraw(kind: 'yank' | 'quarantine') {
    if (!releaseId) return;
    setWithdrawError(null);
    setWithdrawMessage('');
    const row = withdrawReleases.find((r) => r.releaseId === releaseId);
    if (row && row.status !== 'PUBLISHED') {
      setWithdrawError(t('admin.withdrawNeedsPublished'));
      return;
    }
    if (kind === 'quarantine' && !reason.trim()) {
      setWithdrawError(t('admin.withdrawReasonRequired'));
      return;
    }
    if (
      !window.confirm(
        t(kind === 'yank' ? 'admin.yankConfirm' : 'admin.quarantineConfirm', {
          version: row?.version ?? releaseId,
        }),
      )
    ) {
      return;
    }
    try {
      await api.post(`/api/v1/admin/releases/${releaseId}/${kind}`, { reason });
      setReason('');
      await loadWithdrawReleases();
      // Set after the refresh: loadWithdrawReleases clears stale feedback.
      setWithdrawMessage(
        t(kind === 'yank' ? 'admin.yankDone' : 'admin.quarantineDone', {
          version: row?.version ?? '',
        }),
      );
    } catch (e) {
      setWithdrawError(e instanceof Error ? e.message : String(e));
    }
  }

  // ---- manual host-app update upload (手动上传主程序更新包) ----
  const [appReleases, setAppReleases] = useState<AdminAppRelease[]>([]);
  const appFileInput = useRef<HTMLInputElement | null>(null);
  const [appFile, setAppFile] = useState<File | null>(null);
  const [appChangelog, setAppChangelog] = useState('');
  const [appUploading, setAppUploading] = useState(false);
  const [appMessage, setAppMessage] = useState('');
  const [appError, setAppError] = useState<string | null>(null);

  /**
   * Mirrors the server's inference (AdminAppReleaseController): the filename is
   * the single source of truth — version + channel are read straight from it, so
   * the admin only picks a file.
   */
  const appDetected = (() => {
    if (!appFile) return null;
    const m = appFile.name.match(
      /(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|nightly)(?:\.\d+)*)?)/,
    );
    if (!m) return null;
    const lower = m[1].toLowerCase();
    const dash = lower.indexOf('-');
    const label = dash < 0 ? '' : lower.slice(dash + 1);
    const channel = label.startsWith('alpha')
      ? 'alpha'
      : label.startsWith('nightly')
        ? 'nightly'
        : label.startsWith('beta') || label.startsWith('rc')
          ? 'beta'
          : 'stable';
    return { version: m[1], channel };
  })();

  function onAppFileChange() {
    setAppFile(appFileInput.current?.files?.[0] ?? null);
    setAppError(null);
    if (appFileInput.current?.files?.[0] && !appDetected) {
      setAppError(t('admin.appVersionNotDetected'));
    }
  }

  async function loadAppReleases() {
    try {
      setAppReleases(
        await api.get<AdminAppRelease[]>('/api/v1/admin/app-releases'),
      );
    } catch {
      setAppReleases([]);
    }
  }

  /**
   * Intranet manual update (the store replaces the FY-Proxy distribution center):
   * start (version/channel inferred from the filename server-side) → presigned
   * PUT of the package bytes → publish immediately.
   */
  async function uploadAppPackage(event: React.FormEvent) {
    event.preventDefault();
    const file = appFile;
    if (!file) return;
    setAppUploading(true);
    setAppMessage('');
    setAppError(null);
    try {
      const session = await api.post<AdminAppUploadSession>(
        '/api/v1/admin/app-releases',
        {
          changelog: appChangelog || undefined,
          filename: file.name,
          size: file.size,
        },
      );
      await api.putRaw(session.uploadUrl, await file.arrayBuffer());
      setAppMessage(t('admin.appUploaded'));
      const published = await api.post<AdminAppRelease>(
        `/api/v1/admin/app-releases/${session.releaseId}/publish`,
      );
      setAppMessage(t('admin.appPublished', { version: published.version }));
      setAppChangelog('');
      setAppFile(null);
      if (appFileInput.current) appFileInput.current.value = '';
      await loadAppReleases();
    } catch (e) {
      setAppError(e instanceof Error ? e.message : String(e));
    } finally {
      setAppUploading(false);
    }
  }

  async function deleteAppRelease(rel: AdminAppRelease) {
    if (!window.confirm(t('admin.appDeleteConfirm', { version: rel.version })))
      return;
    setAppError(null);
    try {
      await api.delete(`/api/v1/admin/app-releases/${rel.releaseId}`);
      await loadAppReleases();
    } catch (e) {
      setAppError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Refresh the list while a run is open so SYNCING settles on its own. */
  const syncingInProgress = upstreams.some(
    (row) => row.syncStatus === 'SYNCING',
  );
  useEffect(() => {
    if (!syncingInProgress) return;
    const poll = setInterval(() => {
      void loadUpstreams();
    }, 4000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncingInProgress]);

  return (
    <div className="page-shell space-y-8">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : loading ? (
        <LoadingGrid />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
          {/* Grouped section nav: stacked sidebar on desktop, wrapping clusters on mobile. */}
          <nav
            className="flex flex-row flex-wrap gap-x-8 gap-y-5 self-start lg:sticky lg:top-20 lg:flex-col lg:gap-6"
            role="tablist"
            aria-label={t('admin.title')}
          >
            {NAV_GROUPS.map((group) => (
              <div key={group.labelKey} className="min-w-0">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                  {t(group.labelKey)}
                </p>
                <div className="flex flex-wrap gap-1 lg:flex-col lg:items-stretch">
                  {group.items.map((key) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={tab === key}
                      className={cn(
                        'flex items-center rounded-lg px-3 py-1.5 text-left text-sm transition-colors [min-height:2.25rem]',
                        tab === key
                          ? 'bg-accent/10 font-semibold text-accent dark:bg-accent/20'
                          : 'text-muted hover:bg-surface-muted hover:text-ink',
                      )}
                      onClick={() => setTab(key)}
                    >
                      {t(`admin.${key}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="min-w-0">
            <BlurFade key={tab}>
              {tab === 'users' && (
                <section className="space-y-3">
                  <p className="text-sm text-muted">{t('admin.usersHint')}</p>
                  {usersError && (
                    <p className="alert alert-error" role="alert">
                      {usersError}
                    </p>
                  )}
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder={t('admin.userSearch')}
                    className="input max-w-md"
                  />
                  {usersLoading && !users.length ? (
                    <LoadingGrid />
                  ) : !filteredUsers.length ? (
                    <EmptyState title={t('common.empty')} />
                  ) : (
                    <div className="table-card">
                      <table>
                        <thead>
                          <tr>
                            <th>{t('admin.userAccount')}</th>
                            <th>{t('account.roles')}</th>
                            <th>{t('beeLevel.title')}</th>
                            <th>{t('admin.userStatus')}</th>
                            <th>{t('admin.userLastLogin')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredUsers.map((row) => (
                            <tr
                              key={row.userId}
                              className="border-t border-line"
                            >
                              <td>
                                <div className="font-medium">
                                  {row.displayName}
                                </div>
                                <code className="block text-xs text-muted">
                                  {row.email}
                                </code>
                              </td>
                              <td>
                                <div className="flex items-center gap-2">
                                <span className="flex flex-wrap items-center gap-1">
                                  {row.roles.map((role) => (
                                    <Badge
                                      key={role}
                                      variant="outline"
                                      className={cn(
                                        badgeBaseClass,
                                        badgeToneClass.muted,
                                      )}
                                    >
                                      {t(`role.${role}`)}
                                    </Badge>
                                  ))}
                                </span>
                                <UserRolesEditor roles={row.roles} displayName={row.displayName ?? undefined} email={row.email}
                                  isSelf={auth.user?.userId === row.userId}
                                  onSave={async roles => {
                                    const updated = await api.updateAdminUser(row.userId, { roles });
                                    setUsers(current => current.map(user => user.userId === row.userId ? { ...user, ...updated } : user));
                                    if (auth.user?.userId === row.userId) patchUser({ roles: updated.roles });
                                  }} />
                                </div>
                              </td>
                              <td>
                                {/* The badge itself is the trigger: click to change the level
                  in place, no duplicate dropdown beside it. */}
                                <SelectMenu
                                  value={row.beeLevel}
                                  options={BEE_LEVELS.map((level) => ({
                                    value: level,
                                    label: beeLevelLabel(level),
                                  }))}
                                  ariaLabel={t('admin.setBeeLevel')}
                                  disabled={savingUserId === row.userId}
                                  onValueChange={(v) =>
                                    void setUserBeeLevel(row, Number(v))
                                  }
                                  trigger={
                                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                      <BeeLevelBadge level={row.beeLevel} />
                                    </span>
                                  }
                                />
                                {/* A purchased membership riding above the granted level. */}
                                {row.effectiveBeeLevel > row.beeLevel && (
                                  <span
                                    className="mt-1 flex items-center gap-1 text-xs text-muted"
                                    title={formatDateTime(
                                      row.membershipExpiresAt,
                                    )}
                                  >
                                    <BeeLevelBadge
                                      level={row.effectiveBeeLevel}
                                      compact
                                    />
                                    {` ${t('admin.membershipUntil', { date: formatDate(row.membershipExpiresAt) })}`}
                                  </span>
                                )}
                              </td>
                              <td>
                                <button
                                  className={cn(
                                    'btn btn-sm',
                                    row.status === 'ACTIVE'
                                      ? 'btn-danger-outline'
                                      : 'btn-success',
                                  )}
                                  disabled={savingUserId === row.userId}
                                  onClick={() => void toggleUserStatus(row)}
                                >
                                  {row.status === 'ACTIVE'
                                    ? t('admin.disable')
                                    : t('admin.enable')}
                                </button>
                              </td>
                              <td className="text-xs text-muted">
                                {formatDateTime(row.lastLoginAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {tab === 'membership' && (
                <section className="space-y-5">
                  <p className="text-sm text-muted">
                    {t('admin.membershipHint')}
                  </p>
                  {membershipError && (
                    <p className="alert alert-error" role="alert">
                      {membershipError}
                    </p>
                  )}
                  {membershipLoading && !membershipPlans.length ? (
                    <LoadingGrid />
                  ) : (
                    <>
                      <div className="table-card">
                        <table data-testid="membership-plans-table">
                          <thead>
                            <tr>
                              <th>{t('beeLevel.title')}</th>
                              <th>{t('admin.membershipDuration')}</th>
                              <th>{t('admin.membershipPrice')}</th>
                              <th>{t('admin.membershipExternalUrl')}</th>
                              <th>{t('admin.visibility')}</th>
                              <th>{t('admin.membershipSort')}</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {membershipPlans.map((plan) => (
                              <tr
                                key={plan.planId}
                                className="border-t border-line"
                              >
                                <td>
                                  <SelectMenu
                                    value={plan.beeLevel}
                                    options={PURCHASABLE_LEVELS.map(
                                      (level) => ({
                                        value: level,
                                        label: beeLevelLabel(level),
                                      }),
                                    )}
                                    ariaLabel={t('admin.setBeeLevel')}
                                    disabled={busyPlanId === plan.planId}
                                    onValueChange={(v) =>
                                      void updatePlan(plan, {
                                        beeLevel: Number(v),
                                      })
                                    }
                                    trigger={
                                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                        <BeeLevelBadge level={plan.beeLevel} />
                                      </span>
                                    }
                                  />
                                </td>
                                <td>
                                  <label
                                    className="sr-only"
                                    htmlFor={`duration-${plan.planId}`}
                                  >
                                    {t('admin.membershipDuration')}
                                  </label>
                                  <input
                                    id={`duration-${plan.planId}`}
                                    className="input w-24"
                                    type="number"
                                    min={1}
                                    defaultValue={plan.durationDays}
                                    key={`duration-${plan.planId}-${plan.durationDays}`}
                                    disabled={busyPlanId === plan.planId}
                                    onChange={(e) =>
                                      void updatePlan(plan, {
                                        durationDays: Math.max(
                                          1,
                                          Number(e.target.value),
                                        ),
                                      })
                                    }
                                  />
                                  <span className="ml-1 text-xs text-muted">
                                    {t('membership.daysUnit')}
                                  </span>
                                </td>
                                <td>
                                  <label
                                    className="sr-only"
                                    htmlFor={`price-${plan.planId}`}
                                  >
                                    {t('admin.membershipPrice')}
                                  </label>
                                  <input
                                    id={`price-${plan.planId}`}
                                    className="input w-24"
                                    type="text"
                                    inputMode="decimal"
                                    defaultValue={(
                                      plan.priceFen / 100
                                    ).toString()}
                                    key={`price-${plan.planId}-${plan.priceFen}`}
                                    disabled={busyPlanId === plan.planId}
                                    onChange={(e) =>
                                      void updatePlan(plan, {
                                        priceFen: Math.max(
                                          0,
                                          Math.round(
                                            Number(e.target.value || '0') * 100,
                                          ),
                                        ),
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  {/* Hosted-checkout link (Buy Me a Coffee Extra); blank = gateway checkout. */}
                                  <label
                                    className="sr-only"
                                    htmlFor={`url-${plan.planId}`}
                                  >
                                    {t('admin.membershipExternalUrl')}
                                  </label>
                                  <input
                                    id={`url-${plan.planId}`}
                                    className="input w-56 font-mono text-xs"
                                    type="url"
                                    defaultValue={plan.externalUrl ?? ''}
                                    key={`url-${plan.planId}-${plan.externalUrl ?? ''}`}
                                    placeholder={t(
                                      'admin.membershipExternalUrlPlaceholder',
                                    )}
                                    disabled={busyPlanId === plan.planId}
                                    onChange={(e) =>
                                      void updatePlan(plan, {
                                        externalUrl: e.target.value.trim(),
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <button
                                    className={cn(
                                      'btn btn-sm',
                                      plan.active
                                        ? 'btn-danger-outline'
                                        : 'btn-success',
                                    )}
                                    disabled={busyPlanId === plan.planId}
                                    onClick={() =>
                                      void updatePlan(plan, {
                                        active: !plan.active,
                                      })
                                    }
                                  >
                                    {plan.active
                                      ? t('admin.delist')
                                      : t('admin.relist')}
                                  </button>
                                </td>
                                <td>
                                  <label
                                    className="sr-only"
                                    htmlFor={`sort-${plan.planId}`}
                                  >
                                    {t('admin.membershipSort')}
                                  </label>
                                  <input
                                    id={`sort-${plan.planId}`}
                                    className="input w-16"
                                    type="number"
                                    defaultValue={plan.sort}
                                    key={`sort-${plan.planId}-${plan.sort}`}
                                    disabled={busyPlanId === plan.planId}
                                    onChange={(e) =>
                                      void updatePlan(plan, {
                                        sort: Number(e.target.value),
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <button
                                    className="btn btn-sm btn-danger-outline"
                                    disabled={busyPlanId === plan.planId}
                                    onClick={() => void removePlan(plan)}
                                  >
                                    {t('admin.dbDelete')}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Create row: yuan in, fen out. */}
                      <form
                        className="card grid gap-3 p-4 sm:grid-cols-6 sm:items-end"
                        onSubmit={addPlan}
                      >
                        <label className="block text-sm">
                          {t('beeLevel.title')}
                          <span className="mt-1 block">
                            <SelectMenu
                              value={newPlan.beeLevel}
                              options={PURCHASABLE_LEVELS.map((level) => ({
                                value: level,
                                label: beeLevelLabel(level),
                              }))}
                              ariaLabel={t('admin.setBeeLevel')}
                              onValueChange={(v) =>
                                setNewPlan({ ...newPlan, beeLevel: Number(v) })
                              }
                              trigger={
                                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                  <BeeLevelBadge level={newPlan.beeLevel} />
                                </span>
                              }
                            />
                          </span>
                        </label>
                        <label className="block text-sm">
                          {t('admin.membershipDuration')}
                          <input
                            value={newPlan.durationDays}
                            onChange={(e) =>
                              setNewPlan({
                                ...newPlan,
                                durationDays: Math.max(
                                  1,
                                  Number(e.target.value) || 1,
                                ),
                              })
                            }
                            className="input mt-1"
                            type="number"
                            min={1}
                            required
                          />
                        </label>
                        <label className="block text-sm">
                          {t('admin.membershipPrice')}（¥）
                          <input
                            value={newPlanYuan}
                            onChange={(e) =>
                              setNewPlan({
                                ...newPlan,
                                priceFen:
                                  Math.round(
                                    Number.parseFloat(e.target.value || '0') *
                                      100,
                                  ) || 0,
                              })
                            }
                            className="input mt-1"
                            inputMode="decimal"
                            required
                          />
                        </label>
                        <label className="block text-sm">
                          {t('admin.membershipSort')}
                          <input
                            value={newPlan.sort}
                            onChange={(e) =>
                              setNewPlan({
                                ...newPlan,
                                sort: Number(e.target.value),
                              })
                            }
                            className="input mt-1"
                            type="number"
                          />
                        </label>
                        <label className="block text-sm sm:col-span-2">
                          {t('admin.membershipExternalUrl')}
                          <input
                            value={newPlan.externalUrl}
                            onChange={(e) =>
                              setNewPlan({
                                ...newPlan,
                                externalUrl: e.target.value.trim(),
                              })
                            }
                            className="input mt-1 font-mono text-xs"
                            type="url"
                            placeholder={t(
                              'admin.membershipExternalUrlPlaceholder',
                            )}
                          />
                        </label>
                        <button
                          className="btn btn-primary sm:col-span-6"
                          disabled={membershipLoading}
                        >
                          {t('admin.membershipAdd')}
                        </button>
                      </form>

                      {/* Order stream */}
                      <h3 className="pt-2 text-lg font-semibold">
                        {t('admin.membershipOrders')}
                      </h3>
                      {!membershipOrders.length ? (
                        <EmptyState title={t('common.empty')} />
                      ) : (
                        <div className="table-card">
                          <table>
                            <thead>
                              <tr>
                                <th>{t('admin.membershipOrderNo')}</th>
                                <th>{t('admin.userAccount')}</th>
                                <th>{t('beeLevel.title')}</th>
                                <th>{t('admin.membershipPrice')}</th>
                                <th>{t('admin.membershipStatus')}</th>
                                <th>{t('admin.membershipPaidAt')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {membershipOrders.map((order) => (
                                <tr
                                  key={order.orderNo}
                                  className="border-t border-line"
                                >
                                  <td>
                                    <code className="text-xs">
                                      {order.orderNo}
                                    </code>
                                  </td>
                                  <td>
                                    <div className="font-medium">
                                      {order.displayName ?? '—'}
                                    </div>
                                    <code className="block text-xs text-muted">
                                      {order.email}
                                    </code>
                                  </td>
                                  <td>
                                    <BeeLevelBadge level={order.targetLevel} />
                                  </td>
                                  <td>{formatFen(order.priceFen ?? 0)}</td>
                                  <td>
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        badgeBaseClass,
                                        badgeToneClass[
                                          membershipOrderTone(
                                            order.status ?? '',
                                          )
                                        ],
                                      )}
                                      style={
                                        membershipOrderTone(
                                          order.status ?? '',
                                        ) === 'gold'
                                          ? {
                                              backgroundImage:
                                                'linear-gradient(135deg, rgba(253,230,138,.3), rgba(245,158,11,.15))',
                                            }
                                          : undefined
                                      }
                                    >
                                      {order.status}
                                    </Badge>
                                  </td>
                                  <td className="text-xs text-muted">
                                    {formatDateTime(order.paidAt)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}

              {tab === 'invitations' && (
                <section className="space-y-5">
                  <p className="text-sm text-muted">
                    {t('admin.invitationsHint')}
                  </p>
                  {invitationsError && (
                    <p className="alert alert-error" role="alert">
                      {invitationsError}
                    </p>
                  )}

                  {/* The registration switch (邀请注册开关). */}
                  <div
                    className="card flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"
                    data-testid="registration-policy-card"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {t('admin.registrationSwitchTitle')}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {t('admin.registrationSwitchHint')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          badgeBaseClass,
                          registrationPolicy?.invitationRequired
                            ? badgeToneClass.success
                            : badgeToneClass.muted,
                        )}
                        data-testid="registration-policy-state"
                      >
                        {registrationPolicy?.invitationRequired
                          ? t('admin.registrationOn')
                          : t('admin.registrationOff')}
                      </Badge>
                      <button
                        type="button"
                        className={cn(
                          'btn',
                          registrationPolicy?.invitationRequired
                            ? 'btn-danger-outline'
                            : 'btn-success',
                        )}
                        data-testid="registration-policy-toggle"
                        disabled={
                          switchingPolicy || registrationPolicy === null
                        }
                        onClick={() => void toggleRegistrationPolicy()}
                      >
                        {switchingPolicy
                          ? t('common.loading')
                          : registrationPolicy?.invitationRequired
                            ? t('admin.registrationTurnOff')
                            : t('admin.registrationTurnOn')}
                      </button>
                    </div>
                  </div>

                  {/* Unlimited issuance (管理员无限发放). */}
                  <div className="card flex flex-wrap items-center justify-between gap-3 rounded-xl p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {t('admin.issueInvitationTitle')}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {t('admin.issueInvitationHint')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {lastIssuedCode && (
                        <code
                          className="rounded-lg bg-surface-muted px-3 py-1.5 font-mono text-sm tracking-wider"
                          data-testid="last-issued-code"
                        >
                          {lastIssuedCode.code}
                        </code>
                      )}
                      <button
                        type="button"
                        className="btn btn-primary"
                        data-testid="admin-issue-invitation"
                        disabled={issuingAdminCode}
                        onClick={() => void issueAdminInvitation()}
                      >
                        {issuingAdminCode
                          ? t('common.loading')
                          : t('admin.issueInvitation')}
                      </button>
                    </div>
                  </div>

                  {/* The store-wide code ledger. */}
                  {invitationsLoading && !adminInvitations.length ? (
                    <LoadingGrid />
                  ) : !adminInvitations.length ? (
                    <EmptyState title={t('admin.noInvitations')} />
                  ) : (
                    <div className="table-card">
                      <table data-testid="admin-invitations-table">
                        <thead>
                          <tr>
                            <th>{t('admin.invitationCode')}</th>
                            <th>{t('admin.invitationCreator')}</th>
                            <th>{t('admin.invitationCreatedAt')}</th>
                            <th>{t('admin.invitationStatus')}</th>
                            <th>{t('admin.invitationUsedAt')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminInvitations.map((code) => (
                            <tr
                              key={code.codeId}
                              className="border-t border-line"
                            >
                              <td>
                                <code className="font-mono tracking-wider">
                                  {code.code}
                                </code>
                              </td>
                              <td className="text-xs text-muted">
                                {code.createdByEmail ?? code.createdBy}
                              </td>
                              <td className="text-xs text-muted">
                                {formatDateTime(code.createdAt)}
                              </td>
                              <td>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    badgeBaseClass,
                                    code.usedBy
                                      ? badgeToneClass.muted
                                      : badgeToneClass.success,
                                  )}
                                >
                                  {code.usedBy
                                    ? t('account.invitationUsedBy', {
                                        email:
                                          code.usedByEmail ?? code.usedBy,
                                      })
                                    : t('account.invitationUnused')}
                                </Badge>
                              </td>
                              <td className="text-xs text-muted">
                                {code.usedAt
                                  ? formatDateTime(code.usedAt)
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {tab === 'databases' && (
                <section className="space-y-5">
                  <p className="text-sm text-muted">
                    {t('admin.databasesHint')}
                  </p>
                  {databasesError && (
                    <p className="alert alert-error" role="alert">
                      {databasesError}
                    </p>
                  )}

                  {dataSourceStatus && (
                    <div className="rounded-lg p-6 card">
                      <h3 className="mb-3 font-semibold">
                        {t('admin.currentDataSource')}
                      </h3>
                      <dl className="grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-muted">{t('admin.dbProduct')}</dt>
                          <dd className="font-medium">
                            {dataSourceStatus.productName ?? '—'}
                            {` ${dataSourceStatus.productVersion ? `(${dataSourceStatus.productVersion})` : ''}`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted">{t('admin.dbUser')}</dt>
                          <dd className="font-medium">
                            {dataSourceStatus.username ?? '—'}
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-muted">{t('admin.dbUrl')}</dt>
                          <dd>
                            <code className="break-all text-xs">
                              {dataSourceStatus.url ?? '—'}
                            </code>
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-muted">
                            {t('admin.remoteOverride')}
                          </dt>
                          <dd className="mt-1 flex flex-wrap items-center gap-2">
                            {dataSourceStatus.remoteOverrideActive ? (
                              <Badge
                                variant="outline"
                                className={cn(
                                  badgeBaseClass,
                                  badgeToneClass.success,
                                )}
                              >
                                {t('admin.overrideActive')}
                                {dataSourceStatus.overrideName
                                  ? ` · ${dataSourceStatus.overrideName}`
                                  : ''}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className={cn(
                                  badgeBaseClass,
                                  badgeToneClass.muted,
                                )}
                              >
                                {t('admin.overrideInactive')}
                              </Badge>
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )}

                  <div className="rounded-lg p-6 card">
                    <h3 className="mb-3 font-semibold">
                      {t('admin.addDatabase')}
                    </h3>
                    <form
                      className="grid gap-3 sm:grid-cols-2"
                      onSubmit={addDatabase}
                    >
                      <label className="block text-sm">
                        {t('admin.dbName')}
                        <input
                          value={newDb.name}
                          onChange={(e) =>
                            setNewDb({ ...newDb, name: e.target.value })
                          }
                          required
                          maxLength={100}
                          placeholder="production-pg"
                          className="input mt-1"
                        />
                      </label>
                      <label className="block text-sm">
                        {t('admin.dbUser')}
                        <input
                          value={newDb.username}
                          onChange={(e) =>
                            setNewDb({ ...newDb, username: e.target.value })
                          }
                          required
                          maxLength={200}
                          placeholder="store"
                          className="input mt-1"
                        />
                      </label>
                      <label className="block text-sm sm:col-span-2">
                        {t('admin.dbJdbcUrl')}
                        <input
                          value={newDb.jdbcUrl}
                          onChange={(e) =>
                            setNewDb({ ...newDb, jdbcUrl: e.target.value })
                          }
                          required
                          maxLength={500}
                          placeholder="jdbc:postgresql://db.example.com:5432/store"
                          className="input mt-1 font-mono text-xs"
                        />
                      </label>
                      <label className="block text-sm">
                        {t('admin.dbPassword')}
                        <input
                          value={newDb.password}
                          onChange={(e) =>
                            setNewDb({ ...newDb, password: e.target.value })
                          }
                          required
                          type="password"
                          autoComplete="new-password"
                          className="input mt-1"
                        />
                      </label>
                      <div className="sm:self-end">
                        <button disabled={addingDb} className="btn btn-primary">
                          {addingDb
                            ? t('common.loading')
                            : t('admin.addDatabase')}
                        </button>
                      </div>
                      <p className="text-xs text-muted sm:col-span-2">
                        {t('admin.dbSecurityHint')}
                      </p>
                    </form>
                  </div>

                  {databasesLoading && !databases.length ? (
                    <LoadingGrid />
                  ) : !databases.length ? (
                    <EmptyState title={t('admin.noDatabases')} />
                  ) : (
                    <ul className="space-y-2">
                      {databases.map((row) => (
                        <li
                          key={row.databaseId}
                          className="card flex flex-wrap items-center justify-between gap-3 p-4"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{row.name}</span>
                              {row.enabled && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    badgeBaseClass,
                                    badgeToneClass.success,
                                  )}
                                >
                                  {t('admin.dbEnabled')}
                                </Badge>
                              )}
                              {row.lastTestOk === true ? (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    badgeBaseClass,
                                    badgeToneClass.success,
                                  )}
                                >
                                  {t('admin.dbTestOk')}
                                </Badge>
                              ) : row.lastTestOk === false ? (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    badgeBaseClass,
                                    badgeToneClass.danger,
                                  )}
                                >
                                  {t('admin.dbTestFailed')}
                                </Badge>
                              ) : null}
                            </div>
                            <code className="block truncate text-xs text-muted">
                              {row.jdbcUrl}
                            </code>
                            {row.lastTestError && (
                              <p className="mt-1 text-xs text-red-600">
                                {row.lastTestError}
                              </p>
                            )}
                            {row.lastTestedAt && (
                              <p className="text-xs text-muted">
                                {t('admin.dbLastTested')}:{' '}
                                {formatDateTime(row.lastTestedAt)}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              disabled={dbBusyId === row.databaseId}
                              className="btn btn-secondary btn-sm"
                              onClick={() => void probeDatabase(row)}
                            >
                              {t('admin.dbTest')}
                            </button>
                            <button
                              disabled={dbBusyId === row.databaseId}
                              className={cn(
                                'btn btn-sm',
                                row.enabled ? 'btn-secondary' : 'btn-primary',
                              )}
                              onClick={() => void toggleActivation(row)}
                            >
                              {row.enabled
                                ? t('admin.dbDeactivate')
                                : t('admin.dbActivate')}
                            </button>
                            <button
                              disabled={dbBusyId === row.databaseId}
                              className="btn btn-danger btn-sm"
                              onClick={() => void removeDatabase(row)}
                            >
                              {t('admin.dbDelete')}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {lastProbe && (
                    <div className="card p-4 text-sm" role="status">
                      {lastProbe.ok ? (
                        <>
                          ✅ {t('admin.dbTestOk')} — {lastProbe.productName}
                          {` ${lastProbe.productVersion ?? ''}`}
                        </>
                      ) : (
                        <>
                          ❌ {t('admin.dbTestFailed')} — {lastProbe.error}
                        </>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-muted">
                    {t('admin.dbActivateHint')}
                  </p>
                </section>
              )}

              {tab === 'upstreams' && (
                <section className="space-y-5">
                  <p className="text-sm text-muted">
                    {t('admin.upstreamsHint')}
                  </p>

                  <div className="rounded-lg p-6 card">
                    <h3 className="mb-3 font-semibold">
                      {t('admin.addUpstream')}
                    </h3>
                    <form
                      className="grid gap-3 sm:grid-cols-2"
                      onSubmit={addUpstream}
                    >
                      <label className="block text-sm">
                        {t('admin.upstreamName')}
                        <input
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          required
                          placeholder="superpowers"
                          className="input mt-1"
                        />
                      </label>
                      <label className="block text-sm">
                        {t('admin.upstreamUrl')}
                        <input
                          value={newUrl}
                          onChange={(e) => setNewUrl(e.target.value)}
                          required
                          type="url"
                          placeholder="https://github.com/obra/superpowers"
                          className="input mt-1"
                        />
                      </label>
                      <label className="block text-sm">
                        {t('admin.upstreamNamespace')}
                        <input
                          value={newNamespace}
                          onChange={(e) => setNewNamespace(e.target.value)}
                          required
                          pattern="[a-z0-9][a-z0-9\-]{0,62}"
                          placeholder="superpowers"
                          className="input mt-1"
                        />
                      </label>
                      <label className="block text-sm">
                        {t('admin.upstreamAdapter')}
                        <span className="mt-1 block">
                          <SelectMenu
                            value={newAdapter}
                            options={[
                              { value: 'AUTO', label: 'AUTO' },
                              {
                                value: 'CLAUDE_MARKETPLACE',
                                label: 'CLAUDE_MARKETPLACE',
                              },
                              {
                                value: 'SKILL_REPOSITORY',
                                label: 'SKILL_REPOSITORY',
                              },
                              { value: 'MCP_REGISTRY', label: 'MCP_REGISTRY' },
                              {
                                value: 'SKILLHUB_REGISTRY',
                                label: 'SKILLHUB_REGISTRY',
                              },
                            ]}
                            ariaLabel={t('admin.upstreamAdapter')}
                            onValueChange={(v) => setNewAdapter(String(v))}
                          />
                        </span>
                      </label>
                      <div className="sm:col-span-2">
                        <button disabled={adding} className="btn btn-primary">
                          {adding
                            ? t('common.loading')
                            : t('admin.addUpstream')}
                        </button>
                      </div>
                    </form>
                  </div>

                  {upstreamsLoading && !upstreams.length ? (
                    <LoadingGrid />
                  ) : !upstreams.length ? (
                    <EmptyState title={t('admin.noUpstreams')} />
                  ) : (
                    <ul className="space-y-2">
                      {upstreams.map((row) => (
                        <li key={row.upstreamId} className="card p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold">
                                  {row.name}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    badgeBaseClass,
                                    badgeToneClass.muted,
                                  )}
                                >
                                  {row.targetNamespace}
                                </Badge>
                                {row.adapterType && (
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      badgeBaseClass,
                                      badgeToneClass.accent,
                                    )}
                                  >
                                    {row.adapterType}
                                  </Badge>
                                )}
                              </div>
                              <code className="block truncate text-xs text-muted">
                                {row.marketplaceUrl}
                              </code>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                className="btn btn-secondary btn-sm"
                                disabled={
                                  logLoading &&
                                  logUpstream?.upstreamId === row.upstreamId
                                }
                                onClick={() => void openSyncLog(row)}
                              >
                                {t('admin.viewLog')}
                              </button>
                              <button
                                disabled={
                                  syncingId === row.upstreamId ||
                                  row.syncStatus === 'SYNCING'
                                }
                                className="btn btn-primary btn-sm"
                                onClick={() => void syncNow(row)}
                              >
                                {t('admin.syncNow')}
                              </button>
                            </div>
                          </div>
                          {/* Sync state lives under the upstream info: syncing / ok / failed,
               with the details one click away instead of an inline error wall. */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-sm">
                            {row.syncStatus === 'SYNCING' ? (
                              <span className="inline-flex items-center gap-1.5 font-medium text-accent">
                                <span
                                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                                  aria-hidden="true"
                                />
                                {t('admin.syncSyncing')}
                              </span>
                            ) : row.syncStatus === 'OK' ? (
                              <>
                                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600">
                                  <span aria-hidden="true">✓</span>
                                  {t('admin.syncOk')}
                                </span>
                                <span className="text-xs text-muted">
                                  {t('admin.syncImported', {
                                    n: row.lastRunImported ?? 0,
                                  })}{' '}
                                  ·
                                  {` ${t('admin.syncSkipped', { n: row.lastRunSkipped ?? 0 })}`}
                                </span>
                              </>
                            ) : row.syncStatus === 'FAILED' ? (
                              <>
                                <span className="inline-flex items-center gap-1.5 font-medium text-danger">
                                  <span aria-hidden="true">✗</span>
                                  {t('admin.syncFailed')}
                                </span>
                                <span className="text-xs text-muted">
                                  {t('admin.syncFailedCount', {
                                    n: row.lastRunFailed ?? 0,
                                  })}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted">
                                {t('admin.syncPending')}
                              </span>
                            )}
                            {row.lastSyncAt && (
                              <span className="ml-auto text-xs text-muted">
                                {formatDateTime(row.lastSyncAt)}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Sync-log viewer: full per-run detail on demand, not inline on cards. */}
                  {logUpstream && (
                    <div
                      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
                      role="dialog"
                      aria-modal="true"
                      aria-label={t('admin.syncLogTitle', {
                        name: logUpstream.name,
                      })}
                      onClick={(e) => {
                        if (e.target === e.currentTarget) closeSyncLog();
                      }}
                    >
                      <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg p-6 card">
                        <div className="mb-4 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold">
                              {t('admin.syncLogTitle', {
                                name: logUpstream.name,
                              })}
                            </h3>
                            <code className="block truncate text-xs text-muted">
                              {logUpstream.marketplaceUrl}
                            </code>
                          </div>
                          <button
                            className="btn btn-secondary btn-sm shrink-0"
                            onClick={closeSyncLog}
                          >
                            {t('common.close')}
                          </button>
                        </div>
                        {logLoading ? (
                          <p
                            role="status"
                            className="py-8 text-center text-muted"
                          >
                            {t('common.loading')}
                          </p>
                        ) : !logRuns?.length ? (
                          <EmptyState title={t('admin.syncLogEmpty')} />
                        ) : (
                          <ol className="space-y-3">
                            {logRuns.map((run) => (
                              <li
                                key={run.runId}
                                className="rounded-xl border border-line p-3 text-sm"
                              >
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      badgeBaseClass,
                                      badgeToneClass[runStatusTone(run.status)],
                                    )}
                                  >
                                    {runStatusLabel(run.status)}
                                  </Badge>
                                  <span className="text-xs text-muted">
                                    {formatDateTime(run.startedAt)}
                                    {run.finishedAt
                                      ? ` → ${formatDateTime(run.finishedAt)}`
                                      : ''}
                                  </span>
                                  <span className="ml-auto text-xs text-muted">
                                    {t('admin.syncImported', {
                                      n: run.imported,
                                    })}{' '}
                                    ·
                                    {` ${t('admin.syncSkipped', { n: run.skipped })}`}{' '}
                                    ·
                                    {` ${t('admin.syncFailedCount', { n: run.failed })}`}
                                  </span>
                                </div>
                                {Boolean(run.errors?.length) && (
                                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface-muted p-2.5 text-xs whitespace-pre-wrap break-all text-red-600">
                                    {(run.errors ?? []).join('\n')}
                                  </pre>
                                )}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {tab === 'listings' && (
                <section className="space-y-3">
                  <p className="text-sm text-muted">
                    {t('admin.listingsHint')}
                  </p>
                  {listingsError && (
                    <p className="alert alert-error" role="alert">
                      {listingsError}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      value={listingSearch}
                      onChange={(e) => setListingSearch(e.target.value)}
                      placeholder={t('admin.listingSearch')}
                      className="input max-w-md"
                    />
                    <span className="text-xs text-muted">
                      {listingsLoading && adminListings.length
                        ? t('common.loading')
                        : t('admin.listingsCount', { n: listingsTotal })}
                    </span>
                  </div>
                  {listingsLoading && !adminListings.length ? (
                    <LoadingGrid />
                  ) : !filteredListings.length ? (
                    <EmptyState title={t('common.empty')} />
                  ) : (
                    <div className="table-card">
                      <table className="admin-listings-table">
                        <colgroup>
                          <col style={{ width: '26%' }} />
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '15%' }} />
                          <col style={{ width: '20%' }} />
                          <col style={{ width: '11%' }} />
                          <col style={{ width: '18%' }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>{t('admin.listingName')}</th>
                            <th>{t('common.type')}</th>
                            <th>{t('publisher.version')}</th>
                            <th>{t('admin.visibility')}</th>
                            <th>{t('admin.featured')}</th>
                            <th>{t('admin.minBeeLevel')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredListings.map((row) => (
                            <tr key={row.listingId}>
                              <td className="min-w-0">
                                <Link
                                  to={listingRoute(row.coordinate)}
                                  title={row.name}
                                  className="block truncate font-medium hover:text-accent"
                                >
                                  {row.name}
                                </Link>
                                <code title={row.coordinate} className="mt-1 block truncate text-xs text-muted">
                                  {row.coordinate}
                                </code>
                              </td>
                              <td className="whitespace-nowrap">{t(`type.${row.type}`)}</td>
                              <td className="whitespace-nowrap">
                                {row.latestVersion
                                  ? 'v' + row.latestVersion
                                  : '—'}
                              </td>
                              <td>
                                <div className="flex flex-wrap items-center gap-2">
                                  {/* State and action are separate: the button label alone
                   could not say what the listing currently IS. */}
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      badgeBaseClass,
                                      row.visibility === 'PUBLIC'
                                        ? badgeToneClass.success
                                        : badgeToneClass.danger,
                                    )}
                                  >
                                    {row.visibility === 'PUBLIC'
                                      ? t('admin.visiblePublic')
                                      : t('admin.visibleUnlisted')}
                                  </Badge>
                                  <button
                                    className={cn(
                                      'btn whitespace-nowrap',
                                      row.visibility === 'PUBLIC'
                                        ? 'btn-secondary'
                                        : 'btn-success',
                                    )}
                                    onClick={() => void toggleVisibility(row)}
                                  >
                                    {row.visibility === 'PUBLIC'
                                      ? t('admin.delist')
                                      : t('admin.relist')}
                                  </button>
                                </div>
                              </td>
                              <td>
                                <button
                                  className={cn(
                                    'btn whitespace-nowrap',
                                    row.featured
                                      ? 'border border-accent/25 bg-accent/10 text-accent hover:bg-accent/20'
                                      : 'btn-secondary',
                                  )}
                                  aria-pressed={row.featured}
                                  onClick={() => void toggleFeatured(row)}
                                >
                                  {row.featured
                                    ? '★ ' + t('admin.featured')
                                    : t('admin.feature')}
                                </button>
                              </td>
                              <td className="whitespace-nowrap">
                                <SelectMenu
                                  value={row.minBeeLevel}
                                  options={BEE_LEVELS.map((level) => ({
                                    value: level,
                                    label:
                                      level === 0
                                        ? t('admin.beeLevelPublic')
                                        : beeLevelLabel(level, '+'),
                                  }))}
                                  ariaLabel={t('admin.minBeeLevel')}
                                  onValueChange={(v) =>
                                    void setListingLevel(row, Number(v))
                                  }
                                  className="w-full min-w-0"
                                  triggerLabel={row.minBeeLevel === 0
                                    ? t('admin.beeLevelPublic')
                                    : beeLevelLabel(row.minBeeLevel, '+')}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {listingsCursor && (
                    <div className="flex justify-center">
                      <button
                        className="btn btn-secondary"
                        disabled={listingsLoading}
                        onClick={() => void loadAdminListings(true)}
                      >
                        {listingsLoading
                          ? t('common.loading')
                          : t('admin.listingsLoadMore', {
                              n: adminListings.length,
                              total: listingsTotal,
                            })}
                      </button>
                    </div>
                  )}
                </section>
              )}

              {tab === 'reports' && (
                <section className="space-y-4">
                  {!reports.length && (
                    <EmptyState title={t('admin.noReports')} />
                  )}
                  {reports.map((report) => (
                    <div key={report.reportId} className="rounded-lg p-6 card">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h2 className="font-semibold">
                            {report.listingName}
                          </h2>
                          <code className="text-xs text-muted">
                            {report.listingCoordinate}
                          </code>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              badgeBaseClass,
                              badgeToneClass.danger,
                            )}
                          >
                            {t(`admin.reason.${report.reason}`)}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(badgeBaseClass, badgeToneClass.muted)}
                          >
                            {report.status}
                          </Badge>
                        </div>
                      </div>
                      {report.details && (
                        <p className="mt-3 text-sm">{report.details}</p>
                      )}
                      <p className="mt-2 text-xs text-muted">
                        {t('admin.reportedAt')}:{' '}
                        {formatDateTime(report.createdAt)}
                      </p>
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <textarea
                          value={notes[report.reportId ?? ''] ?? ''}
                          onChange={(e) =>
                            setNotes((current) => ({
                              ...current,
                              [report.reportId ?? '']: e.target.value,
                            }))
                          }
                          placeholder={t('admin.resolutionNote')}
                          rows={2}
                          className="input"
                        />
                        <div className="flex gap-2">
                          <button
                            className="btn btn-danger"
                            onClick={() => void resolve(report, 'ACTIONED')}
                          >
                            {t('admin.action')}
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => void resolve(report, 'DISMISSED')}
                          >
                            {t('admin.dismiss')}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {tab === 'appRelease' && (
                <section className="space-y-4">
                  <p className="text-sm text-muted">
                    {t('admin.appReleaseHint')}
                  </p>
                  <div className="rounded-lg p-6 card">
                    <h3 className="mb-3 font-semibold">
                      {t('admin.appReleaseUpload')}
                    </h3>
                    <form
                      className="flex flex-col gap-3"
                      onSubmit={uploadAppPackage}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        {/* Visible picker button: the bare file input renders without a
              clickable button in several browsers. */}
                        <input
                          ref={appFileInput}
                          type="file"
                          accept=".zip,.exe,.msi,.dmg,.pkg,.deb,.AppImage,.jar,.tar.gz"
                          className="hidden"
                          onChange={onAppFileChange}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => appFileInput.current?.click()}
                        >
                          {t('admin.appChooseFile')}
                        </button>
                        <span
                          className={cn(
                            'min-w-0 flex-1 text-sm [overflow-wrap:anywhere]',
                            !appFile && 'text-muted',
                          )}
                        >
                          {appFile ? appFile.name : t('admin.appNoFile')}
                        </span>
                        {appDetected && (
                          <span className="shrink-0">
                            <Badge
                              variant="outline"
                              className={cn(
                                badgeBaseClass,
                                badgeToneClass.accent,
                              )}
                            >
                              v{appDetected.version}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn(
                                'ml-1',
                                badgeBaseClass,
                                badgeToneClass.muted,
                              )}
                            >
                              {appDetected.channel}
                            </Badge>
                          </span>
                        )}
                      </div>
                      <label className="block w-full text-sm">
                        {t('admin.appChangelog')}
                        <textarea
                          value={appChangelog}
                          onChange={(e) => setAppChangelog(e.target.value)}
                          rows={3}
                          className="input mt-1 min-h-24 resize-y"
                        />
                      </label>
                      <button
                        disabled={appUploading || !appFile || !appDetected}
                        className="btn btn-primary self-start whitespace-nowrap"
                      >
                        {appUploading
                          ? t('admin.appUploading')
                          : t('admin.appUploadAndPublish')}
                      </button>
                    </form>
                    {appMessage && (
                      <p className="alert alert-success mt-2" role="status">
                        {appMessage}
                      </p>
                    )}
                    {appError && (
                      <p className="alert alert-error mt-2" role="alert">
                        {appError}
                      </p>
                    )}
                  </div>

                  <h3 className="font-semibold">
                    {t('admin.appReleaseHistory')}
                  </h3>
                  {!appReleases.length ? (
                    <EmptyState title={t('admin.appReleaseEmpty')} />
                  ) : (
                    <ul className="space-y-3 text-sm">
                      {appReleases.map((rel) => (
                        <li
                          key={rel.releaseId}
                          className="card grid min-w-0 grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="font-semibold">
                              v{rel.version}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                badgeBaseClass,
                                badgeToneClass.muted,
                              )}
                            >
                              {t(`channel.${rel.channel}`)}
                            </Badge>
                            <StateChip status={rel.status} />

                          </div>
                          <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                            <span className="whitespace-nowrap text-xs text-muted">
                              {formatDateTime(rel.publishedAt)}
                            </span>
                            <button
                              className="btn btn-danger-outline btn-sm"
                              onClick={() => void deleteAppRelease(rel)}
                            >
                              {t('admin.appDelete')}
                            </button>
                          </div>
                          {!!rel.artifacts?.length && (
                            <ul className="grid min-w-0 gap-1.5 border-t border-line pt-3 sm:col-span-2">
                              {rel.artifacts.map((artifact, index) => (
                                <li key={`${artifact.filename}-${index}`} className="min-w-0">
                                  <code className="block text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
                                    {artifact.filename}
                                  </code>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {tab === 'withdraw' && (
                <section className="space-y-4">
                  <p className="text-sm text-muted">
                    {t('admin.withdrawHint')}
                  </p>
                  <div className="rounded-lg p-6 card">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm">
                        <span className="mb-1 block">
                          {t('admin.withdrawPickListing')}
                        </span>
                        <input
                          value={withdrawSearch}
                          onChange={(e) => setWithdrawSearch(e.target.value)}
                          placeholder={t('admin.listingSearch')}
                          className="input mb-2"
                        />
                        <SelectMenu
                          value={withdrawListingId}
                          options={WITHDRAW_LISTING_OPTIONS}
                          ariaLabel={t('admin.withdrawPickListing')}
                          onValueChange={onWithdrawListingChange}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block">
                          {t('admin.withdrawPickRelease')}
                        </span>
                        <SelectMenu
                          value={releaseId}
                          options={WITHDRAW_RELEASE_OPTIONS}
                          ariaLabel={t('admin.withdrawPickRelease')}
                          disabled={!withdrawListingId}
                          onValueChange={onWithdrawReleaseChange}
                          empty={
                            <span className="block px-3 py-2 text-xs text-muted">
                              {withdrawLoading
                                ? t('common.loading')
                                : t('admin.withdrawPickListingFirst')}
                            </span>
                          }
                        />
                      </label>
                    </div>
                    <label className="mt-3 block text-sm">
                      <span className="mb-1 block">
                        {t('admin.reasonLabel')}
                      </span>
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={t('admin.reasonLabel')}
                        className="input"
                      />
                    </label>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        className="btn btn-secondary"
                        disabled={!releaseId}
                        onClick={() => void withdraw('yank')}
                      >
                        {t('admin.yank')}
                      </button>
                      <button
                        className="btn btn-danger"
                        disabled={!releaseId}
                        onClick={() => void withdraw('quarantine')}
                      >
                        {t('admin.quarantine')}
                      </button>
                    </div>
                    {withdrawMessage && (
                      <p className="alert alert-success mt-3" role="status">
                        {withdrawMessage}
                      </p>
                    )}
                    {withdrawError && (
                      <p className="alert alert-error mt-3" role="alert">
                        {withdrawError}
                      </p>
                    )}
                    <p className="mt-3 text-xs text-muted">
                      {t('admin.quarantineHint')}
                    </p>
                  </div>
                </section>
              )}

              {tab === 'audit' && (
                <section>
                  {!auditEvents.length ? (
                    <EmptyState title={t('common.empty')} />
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {auditEvents.map((event) => (
                        <li key={event.eventId} className="card px-3 py-2">
                          <span className="text-muted">
                            {formatDateTime(event.occurredAt)}
                          </span>
                          {' · '}
                          <span className="font-semibold">{event.action}</span>
                          {' · '}
                          {event.resourceType}/<code>{event.resourceId}</code>
                          {' · '}
                          <span className="text-muted">
                            {event.actorType}:{event.actorId}
                          </span>
                          {event.afterSummary ? ` → ${event.afterSummary}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </BlurFade>
          </div>
        </div>
      )}
    </div>
  );
}
