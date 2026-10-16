import Tabs from '../components/Tabs';
import ArtifactTypeIcon from '../components/ArtifactTypeIcon';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  api,
  ApiRequestError,
  type InvitationCode,
  type Library,
  type MembershipStatus,
  type MyInvitations,
  type PublicUser,
} from '../api/client';
import { BlurFade } from '../components/magicui/blur-fade';
import { Badge } from '@/components/ui/badge';
import BeeCrest from '../components/BeeCrest';
import HexCluster from '../components/HexCluster';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingGrid from '../components/LoadingGrid';
import PageHeader from '../components/PageHeader';
import { formatDate, formatDateTime } from '../utils/format';
import { useAuth, patchUser } from '../stores/auth';
import { badgeToneClass, badgeBaseClass } from '../utils/badgeTone';
import { cn } from '@/lib/utils';

type SessionRow = {
  sessionId: string;
  clientId: string;
  kind: string;
  createdAt: string;
};
type DeviceRow = {
  deviceId: string;
  name: string;
  platform: string;
  revoked: boolean;
};

/**
 * User Center (用户中心): the account-management page — identity, the current
 * Infinia Level with its membership deadline and renew action in one line,
 * account details (display name + password) and sign-in sessions & devices.
 *
 * It deliberately does NOT mirror the global navigation: 我的库 and 组织 have
 * their own destinations (library in the header nav, organizations in the
 * account menu), and the full bee ladder lives on /membership. Information
 * appears exactly once.
 *
 * The hero is the page's signature ("hive passport"): hexagon identity mark
 * and a display-size level statement tinted by the tier.
 */
export default function AccountView() {
  const { t } = useTranslation();
  const auth = useAuth();

  const [user, setUser] = useState<PublicUser | null>(null);
  const [membership, setMembership] = useState<MembershipStatus | null>(null);
  /** Artifacts the account holds entitlements for (我的库 · 已获取). */
  const [artifactCount, setArtifactCount] = useState(0);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [securityTab, setSecurityTab] = useState<'sessions' | 'devices'>('sessions');
  const [securityPage, setSecurityPage] = useState(0);
  const securityCount = securityTab === 'sessions' ? sessions.length : devices.length;
  const pageCount = Math.max(1, Math.ceil(securityCount / 3));
  const currentPage = Math.min(securityPage, pageCount - 1);
  const pageStart = currentPage * 3;
  const sortedSessions = [...sessions].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- account details: display name ----
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // ---- account details: password ----
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // ---- invitation sharing (邀请码分享) ----
  const [invitations, setInvitations] = useState<MyInvitations | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const beeLevel = user?.beeLevel ?? 0;
  /**
   * What the store enforces: max(base, active purchased membership). The
   * membership-status payload is the live source (freshly computed per request);
   * /me's effectiveBeeLevel is the fallback for the moment it is still loading.
   */
  const effectiveLevel =
    membership?.effectiveBeeLevel ?? user?.effectiveBeeLevel ?? beeLevel;
  const nextLevel = effectiveLevel < 4 ? effectiveLevel + 1 : null;
  const hasMembership = membership?.membershipLevel != null;
  /** A renewal is possible while a membership is live; a purchase needs headroom. */
  const canUpgrade = effectiveLevel < 4 || hasMembership;

  const userInitial = Array.from(user?.displayName ?? user?.email ?? '?')[0]
    .toUpperCase();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [me, lib, activeSessions, activeDevices, membershipStatus, myInvitations] =
        await Promise.all([
          api.get<PublicUser>('/api/v1/me'),
          api.get<Library>('/api/v1/me/library'),
          api.get<SessionRow[]>('/api/v1/me/sessions'),
          api.get<DeviceRow[]>('/api/v1/me/devices'),
          api.getMembershipStatus(),
          api.getMyInvitations(),
        ]);
      setUser(me);
      setDisplayNameDraft(me.displayName);
      setArtifactCount(lib.entitlements?.length ?? 0);
      setSessions(activeSessions);
      setDevices(activeDevices);
      setMembership(membershipStatus);
      setInvitations(myInvitations);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    const name = displayNameDraft.trim();
    if (!name || name === user?.displayName) return;
    setSavingProfile(true);
    setProfileMessage(null);
    setProfileError(null);
    try {
      await api.put('/api/v1/me', { displayName: name });
      if (user) setUser({ ...user, displayName: name });
      patchUser({ displayName: name });
      setProfileMessage(t('account.profileSaved'));
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function revokeSession(sessionId: string) {
    await api.delete(`/api/v1/me/sessions/${sessionId}`);
    setSessions((current) => current.filter((s) => s.sessionId !== sessionId));
  }

  /** Level 2+ (or admin) shares codes under the monthly quota — the card shows
   * the locked hint otherwise, so the ladder stays visible as the gate. */
  const canShareInvitations =
    invitations !== null && (invitations.unlimited || invitations.monthlyLimit > 0);
  const invitationQuotaExhausted =
    !invitations?.unlimited &&
    (invitations?.issuedThisMonth ?? 0) >= (invitations?.monthlyLimit ?? 0);

  async function issueInvitation() {
    if (issuing) return;
    setIssuing(true);
    setInvitationError(null);
    try {
      await api.createInvitation();
      setInvitations(await api.getMyInvitations());
    } catch (e) {
      const key =
        e instanceof ApiRequestError && e.code ? `errors.${e.code}` : null;
      const localized = key ? t(key) : key;
      setInvitationError(
        localized !== key
          ? localized
          : e instanceof Error
            ? e.message
            : t('common.error'),
      );
    } finally {
      setIssuing(false);
    }
  }

  function copyInvitation(code: string) {
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopiedCode(code);
        window.setTimeout(
          () => setCopiedCode((current) => (current === code ? null : current)),
          1500,
        );
      })
      .catch(() => undefined);
  }

  function invitationStatusLabel(code: InvitationCode): string {
    return code.usedBy
      ? t('account.invitationUsedBy', {
          email: code.usedByEmail ?? code.usedBy,
        })
      : t('account.invitationUnused');
  }

  async function revokeDevice(deviceId: string) {
    await api.delete(`/api/v1/me/devices/${deviceId}`);
    setDevices((current) =>
      current.map((d) =>
        d.deviceId === deviceId ? { ...d, revoked: true } : d,
      ),
    );
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (savingPassword) return;
    setSavingPassword(true);
    setPasswordMessage(null);
    setPasswordError(null);
    try {
      await api.put('/api/v1/me/password', {
        currentPassword,
        newPassword,
      });
      setPasswordMessage(t('account.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
    } catch (e) {
      setPasswordError(
        e && typeof e === 'object' && 'detail' in e
          ? String((e as { detail?: string }).detail)
          : t('common.error'),
      );
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="account-dashboard relative">

      <div className="page-shell space-y-6">
        <PageHeader title={t('account.title')} />
        <p className="!mt-2 text-sm text-muted">{t('account.overviewHint')}</p>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : loading ? (
          <LoadingGrid />
        ) : user ? (
          <>
            {/* Hero — the hive passport. One line says where you stand and what to
        do next: tier crest, level, membership deadline, renew/purchase. */}
            <BlurFade>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="card grid overflow-hidden rounded-2xl lg:grid-cols-2">
                <section className="flex min-w-0 flex-col justify-between gap-8 p-6 sm:p-8">
                  <div className="flex items-center gap-4">
                    <div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-accent/20 bg-accent/10 text-2xl font-bold text-accent" aria-hidden="true">{userInitial}</div>
                    <div className="min-w-0">
                      <h2 className="break-words text-2xl font-semibold tracking-tight">{user.displayName}</h2>
                      <p className="mt-1 break-all text-sm text-muted">{user.email}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                      {user.roles.map((role) => (
                        <Badge
                          key={role}
                          variant="outline"
                          className={cn(badgeBaseClass, badgeToneClass.muted)}
                        >
                          {t(`role.${role}`)}
                        </Badge>
                      ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-line border-t border-line pt-5">
                    <Link to="/store/library" className="group pr-3" data-testid="account-artifact-count">
                      <span className="block text-2xl font-semibold tabular-nums group-hover:text-accent">{artifactCount}</span>
                      <span className="mt-1 block text-xs text-muted">{t('account.artifactsCount')} ↗</span>
                    </Link>
                    <a href="#account-security" className="px-4" data-testid="account-device-count">
                      <span className="block text-2xl font-semibold tabular-nums">{devices.length}</span>
                      <span className="mt-1 block text-xs text-muted">{t('account.devices')}</span>
                    </a>
                    <a href="#account-security" className="pl-4">
                      <span className="block text-2xl font-semibold tabular-nums">{sessions.length}</span>
                      <span className="mt-1 block text-xs text-muted">{t('account.sessions')}</span>
                    </a>
                  </div>
                </section>
                <section className="relative isolate flex flex-col justify-center gap-7 overflow-hidden border-t border-line bg-surface-muted/40 p-6 sm:p-8 lg:border-l lg:border-t-0">
                  <div className="pointer-events-none absolute -right-12 -top-10 -z-10 size-48 text-accent opacity-50"><HexCluster color="currentColor" /></div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">INFINIA · MEMBERSHIP</p>
                    <div
                      className="relative flex flex-wrap items-center gap-x-3 gap-y-3"
                      data-testid="account-level-line"
                    >
                      <span className="shrink-0 text-accent">
                        <BeeCrest level={effectiveLevel} size={30} monochrome />
                      </span>
                      <p className="flex items-baseline gap-1.5 text-[1.35rem] font-bold leading-none tracking-tight">
                        <span>{t(`beeLevel.${effectiveLevel}`)}</span>
                        <span className="tabular-nums text-accent">
                          Lv{effectiveLevel}
                        </span>
                      </p>
                      {hasMembership ? (
                        <span
                          className="inline-flex items-center gap-2 text-sm text-muted"
                          data-testid="account-membership-active"
                        >
                          <span
                            className="hive-dot"
                            style={{ background: 'var(--color-accent)' }}
                            aria-hidden="true"
                          />
                          {t('account.memberUntil', {
                            date: formatDate(
                              membership?.membershipExpiresAt ?? '',
                            ),
                          })}
                        </span>
                      ) : nextLevel !== null ? (
                        <span className="text-sm text-muted">
                          {t('account.levelNext', {
                            next: t(`beeLevel.${nextLevel}`),
                          })}
                        </span>
                      ) : (
                        <span className="text-sm text-muted">
                          {t('account.levelTop')}
                        </span>
                      )}
                      {canUpgrade && (
                        <Link
                          to="/store/membership"
                          className="btn btn-primary shrink-0 hive-cta"
                          data-testid="account-membership-cta"
                        >
                          {hasMembership
                            ? t('membership.renew')
                            : t('account.membershipCta')}
                        </Link>
                      )}
                    </div>

                  <div className="flex gap-2" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map(level => <span key={level} className={cn('h-1.5 flex-1 rounded-full', level <= effectiveLevel ? 'bg-accent/70' : 'bg-accent/10')} />)}
                  </div>
                </section>
              </div>
              <nav aria-label={t('account.quickAccess')} className="card flex flex-col rounded-2xl p-5">
                <h2 className="font-display mb-3 text-xs font-semibold uppercase tracking-widest text-muted">{t('account.quickAccess')}</h2>
                {[
                  { to: '/store/library', title: t('nav.library'), hint: t('account.libraryHint'), icon: 'SKILL' },
                  { to: '/store/browse', title: t('nav.browse'), hint: t('account.browseHint'), icon: 'PLUGIN' },
                  { to: '/store/organizations', title: t('nav.organizations'), hint: t('account.orgHint'), icon: 'FLOW' },
                ].map(entry => <Link key={entry.to} to={entry.to} className="group flex flex-1 items-center gap-3 rounded-xl px-2 py-4 transition-colors hover:bg-surface-muted">
                  <ArtifactTypeIcon type={entry.icon} className="size-9 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{entry.title}</span><span className="mt-1 block text-xs text-muted">{entry.hint}</span></span>
                  <span aria-hidden="true" className="text-muted transition-transform group-hover:translate-x-1">↗</span>
                </Link>)}
              </nav>
              </div>
            </BlurFade>

            {/* Account management: credentials and sign-in footprint. */}
            <div className="grid items-stretch gap-5 lg:grid-cols-2">
              {/* Account details: display name and password live together. */}
              <BlurFade delay={0.08} className="flex min-w-0">
                <div className="card w-full rounded-2xl p-6 sm:p-8">
                  <h2 className="font-display mb-3 font-semibold">
                    {t('account.editProfile')}
                  </h2>
                  <p className="mb-5 text-xs leading-5 text-muted">{t('account.profileHint')}</p>
                  <form
                    className="grid gap-4"
                    onSubmit={saveProfile}
                  >
                    <label className="w-full text-sm">
                      {t('account.displayName')}
                      <input
                        value={displayNameDraft}
                        onChange={(e) => setDisplayNameDraft(e.target.value)}
                        required
                        minLength={1}
                        maxLength={64}
                        className="input mt-1"
                      />
                    </label>
                    <button
                      disabled={
                        savingProfile ||
                        displayNameDraft.trim() === user.displayName
                      }
                      className="btn btn-primary min-h-11 w-40 max-w-full justify-self-end whitespace-nowrap"
                    >
                      {savingProfile ? t('common.loading') : t('common.confirm')}
                    </button>
                  </form>
                  {profileMessage && (
                    <p className="alert alert-success mt-2" role="status">
                      {profileMessage}
                    </p>
                  )}
                  {profileError && (
                    <p className="alert alert-error mt-2" role="alert">
                      {profileError}
                    </p>
                  )}

                  <div
                    className="my-6 border-t border-line"
                    aria-hidden="true"
                  />
                  <h3 className="font-display mb-2 text-sm font-semibold">
                    {t('account.changePassword')}
                  </h3>
                  <form
                    className="grid gap-4 sm:grid-cols-2"
                    onSubmit={changePassword}
                  >
                    <label className="w-full text-sm">
                      {t('account.currentPassword')}
                      <input
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        type="password"
                        required
                        autoComplete="current-password"
                        className="input mt-1"
                      />
                    </label>
                    <label className="w-full text-sm">
                      {t('account.newPassword')}
                      <input
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        type="password"
                        required
                        minLength={8}
                        aria-describedby="account-password-hint"
                        autoComplete="new-password"
                        className="input mt-1"
                      />
                    </label>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:col-span-2">
                      <p id="account-password-hint" className="text-xs text-muted">{t('account.passwordHint')}</p>
                      <button className="btn btn-primary min-h-11 w-40 max-w-full justify-self-end whitespace-nowrap" disabled={savingPassword || !currentPassword || newPassword.length < 8}>
                        {savingPassword ? t('common.loading') : t('account.changePassword')}
                      </button>
                    </div>
                  </form>
                  {passwordMessage && (
                    <p className="alert alert-success mt-2" role="status">
                      {passwordMessage}
                    </p>
                  )}
                  {passwordError && (
                    <p className="alert alert-error mt-2" role="alert">
                      {passwordError}
                    </p>
                  )}
                </div>
              </BlurFade>

              {/* Sign-in sessions and devices */}
              <BlurFade delay={0.16} className="flex min-w-0">
                <div className="card w-full rounded-2xl p-6 sm:p-8">
                  <h2 id="account-security" className="font-display mb-3 scroll-mt-24 font-semibold">
                    {t('account.signinDevices')}
                  </h2>
                  <p className="mb-5 text-xs leading-5 text-muted">{t('account.securityHint')}</p>

                  <Tabs value={securityTab} onChange={tab => { setSecurityTab(tab); setSecurityPage(0); }}
                    label={t('account.signinDevices')}
                    items={[{ id: 'sessions', label: `${t('account.sessions')} · ${sessions.length}` }, { id: 'devices', label: `${t('account.devices')} · ${devices.length}` }]}>
                    <div className="mt-4">
                    {securityTab === 'sessions' ? <>
                    {!sessions.length ? (
                      <p className="rounded-xl bg-surface-muted px-4 py-8 text-center text-sm text-muted">{t('account.noSessions')}</p>
                    ) : (
                      <ul className="divide-y divide-line text-sm">
                        {sortedSessions.slice(pageStart, pageStart + 3).map((session) => (
                          <li
                            key={session.sessionId}
                            className="flex items-center justify-between gap-3 py-4"
                          >
                            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-muted text-muted" aria-hidden="true">
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{session.clientId === 'store-web' ? 'Infinia Store' : session.clientId}</p>
                              <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
                                <span>{session.kind === 'PASSWORD' ? t('account.passwordLogin') : session.kind}</span>
                                <span aria-hidden="true">·</span>
                                <time dateTime={session.createdAt}>{formatDateTime(session.createdAt)}</time>
                              </p>
                            </div>
                            <button
                              className="btn btn-ghost shrink-0 text-muted hover:bg-danger/5 hover:text-danger"
                              onClick={() =>
                                void revokeSession(session.sessionId)
                              }
                            >
                              {t('account.revoke')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    </> : <>
                    {!devices.length ? (
                      <p className="rounded-xl bg-surface-muted px-4 py-8 text-center text-sm text-muted">{t('account.noDevices')}</p>
                    ) : (
                      <ul className="divide-y divide-line text-sm">
                        {devices.slice(pageStart, pageStart + 3).map((device) => (
                          <li
                            key={device.deviceId}
                            className="flex items-center justify-between gap-3 py-4"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{device.name}</span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  badgeBaseClass,
                                  badgeToneClass.muted,
                                )}
                              >
                                {device.platform}
                              </Badge>
                              {device.revoked && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    badgeBaseClass,
                                    badgeToneClass.danger,
                                  )}
                                >
                                  {t('account.revoked')}
                                </Badge>
                              )}
                            </div>
                            {!device.revoked && (
                              <button
                                className="btn btn-ghost shrink-0 text-muted hover:bg-danger/5 hover:text-danger"
                                onClick={() =>
                                  void revokeDevice(device.deviceId)
                                }
                              >
                                {t('account.revoke')}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    </>}
                    </div>
                  </Tabs>
                  {pageCount > 1 && <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                    <span className="text-xs tabular-nums text-muted">{t('account.pageLabel', { current: currentPage + 1, total: pageCount })}</span>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-secondary" disabled={currentPage === 0} onClick={() => setSecurityPage(currentPage - 1)} aria-label={t('account.previousPage')}>←</button>
                      <button type="button" className="btn btn-secondary" disabled={currentPage + 1 >= pageCount} onClick={() => setSecurityPage(currentPage + 1)} aria-label={t('account.nextPage')}>→</button>
                    </div>
                  </div>}
                </div>
              </BlurFade>
            </div>

            {/* Invitation sharing (邀请码分享): quota, generated codes and their
                redemption state. Below Lv2 the card explains the gate instead. */}
            <BlurFade delay={0.24}>
              <div className="card rounded-2xl p-6 sm:p-8" data-testid="account-invitations">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display font-semibold">{t('account.invitations')}</h2>
                    <p className="mt-1 text-xs leading-5 text-muted">{t('account.invitationsHint')}</p>
                  </div>
                  {canShareInvitations && (
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className="text-xs tabular-nums text-muted"
                        data-testid="account-invitation-quota"
                      >
                        {invitations?.unlimited
                          ? t('account.invitationsUnlimited')
                          : t('account.invitationQuota', {
                              used: invitations?.issuedThisMonth ?? 0,
                              limit: invitations?.monthlyLimit ?? 0,
                            })}
                      </span>
                      <button
                        className="btn btn-primary min-h-11"
                        data-testid="account-issue-invitation"
                        disabled={issuing || invitationQuotaExhausted}
                        onClick={() => void issueInvitation()}
                      >
                        {issuing
                          ? t('common.loading')
                          : invitationQuotaExhausted
                            ? t('account.invitationQuotaEmpty')
                            : t('account.issueInvitation')}
                      </button>
                    </div>
                  )}
                </div>

                {canShareInvitations ? (
                  invitations?.invitations.length ? (
                    <ul className="mt-5 divide-y divide-line text-sm">
                      {invitations.invitations.map((code) => (
                        <li
                          key={code.codeId}
                          className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                        >
                          <code className="rounded-lg bg-surface-muted px-3 py-1.5 font-mono tracking-wider">
                            {code.code}
                          </code>
                          {code.usedBy ? (
                            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                              <Badge
                                variant="outline"
                                className={cn(
                                  badgeBaseClass,
                                  badgeToneClass.muted,
                                )}
                              >
                                {invitationStatusLabel(code)}
                              </Badge>
                              <time dateTime={code.usedAt ?? undefined}>
                                {formatDateTime(code.usedAt ?? '')}
                              </time>
                            </span>
                          ) : (
                            <Badge
                              variant="outline"
                              className={cn(
                                badgeBaseClass,
                                badgeToneClass.success,
                              )}
                            >
                              {t('account.invitationUnused')}
                            </Badge>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary shrink-0"
                            onClick={() => copyInvitation(code.code)}
                          >
                            {copiedCode === code.code
                              ? t('account.invitationCopied')
                              : t('account.copy')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-5 rounded-xl bg-surface-muted px-4 py-6 text-center text-sm text-muted">
                      {t('account.noInvitations')}
                    </p>
                  )
                ) : (
                  <p className="mt-5 flex flex-wrap items-center gap-2 rounded-xl bg-surface-muted px-4 py-6 text-sm text-muted">
                    {t('account.invitationsLocked')}
                    <Link
                      to="/store/membership"
                      className="font-semibold text-accent"
                    >
                      {t('account.invitationsLockedCta')}
                    </Link>
                  </p>
                )}

                {invitationError && (
                  <p className="alert alert-error mt-4" role="alert">
                    {invitationError}
                  </p>
                )}
              </div>
            </BlurFade>
          </>
        ) : null}
      </div>
    </div>
  );
}
