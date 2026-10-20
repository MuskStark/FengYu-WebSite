/**
 * Typed API client. Types are generated from the OpenAPI 3.1 contract
 * (store-contract/src/main/resources/contract/openapi.yaml) via
 * `yarn gen:api` — the contract is the single source of truth (design §10.1).
 */
import type { components, paths } from './schema';

export type ApiError = {
  code?: string;
  title?: string;
  detail?: string;
  status?: number;
  traceId?: string;
  /** Structured parameters from problem+json (e.g. requiredBeeLevel). */
  parameters?: Record<string, unknown>;
};

export class ApiRequestError extends Error implements ApiError {
  code?: string;
  title?: string;
  detail?: string;
  status: number;
  traceId?: string;
  parameters?: Record<string, unknown>;

  constructor(body: ApiError) {
    super(body.detail ?? body.title ?? 'Request failed');
    this.code = body.code;
    this.title = body.title;
    this.detail = body.detail;
    this.status = body.status ?? 0;
    this.traceId = body.traceId;
    this.parameters = body.parameters;
  }
}

const TOKEN_STORAGE = 'infinia.store.token';

/**
 * Access token lives in memory during a session; sessionStorage bridges full
 * page reloads (F5, link shares) so a refresh no longer signs the user out.
 * sessionStorage is tab-scoped and dies with the tab, which keeps the token
 * out of persistent storage while matching what dev builds already did.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) {
    sessionStorage.setItem(TOKEN_STORAGE, token);
  } else {
    sessionStorage.removeItem(TOKEN_STORAGE);
  }
}

export function getAccessToken(): string | null {
  if (accessToken === null && typeof sessionStorage !== 'undefined') {
    accessToken = sessionStorage.getItem(TOKEN_STORAGE);
  }
  return accessToken;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(path, { ...init, headers });
  if (response.status === 204) {
    return undefined as T;
  }
  const isJson = response.headers.get('content-type')?.includes('json');
  const body = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    throw new ApiRequestError(
      (typeof body === 'object' ? body : { detail: String(body) }) as ApiError,
    );
  }
  return body as T;
}

export const api = {
  get: <T>(path: keyof paths | string) => request<T>(path as string),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Raw PUT for presigned upload URLs (no auth header — the ticket authorizes). */
  putRaw: async (url: string, data: ArrayBuffer | Blob) => {
    const response = await fetch(url, { method: 'PUT', body: data });
    if (!response.ok) {
      throw new ApiRequestError({ status: response.status, detail: 'Upload failed' });
    }
  },

  /**
   * Binary download (install packages, artifacts): streams the response as a
   * Blob and hands it to the browser via a synthetic anchor click. Returns the
   * filename from Content-Disposition (falling back to `fallbackName`), so the
   * saved file keeps the server-side name the host's local install mode
   * expects. Problem+json errors surface as ApiRequestError like JSON calls.
   */
  download: async (path: string, fallbackName: string): Promise<string> => {
    const headers = new Headers();
    const token = getAccessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const response = await fetch(path, { headers });
    if (!response.ok) {
      const isJson = response.headers.get('content-type')?.includes('json');
      const body = isJson ? await response.json() : await response.text();
      throw new ApiRequestError(
        (typeof body === 'object' ? body : { detail: String(body) }) as ApiError,
      );
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = disposition.match(/filename\*=(?:UTF-8'')([^;]+)/i)
      ?? disposition.match(/filename="([^";]+)"/i)
      ?? disposition.match(/filename=([^;]+)/i);
    const filename = match ? decodeURIComponent(match[1].replace(/^"|"$/g, '')) : fallbackName;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return filename;
  },

  // ── Upstream aggregation admin (aggregation plan §8) ──

  getUpstreams: () =>
    request<Upstream[]>('/api/v1/admin/upstreams'),

  createUpstream: (body: {
    name: string
    marketplaceUrl: string
    targetNamespace: string
    adapterType?: string
  }) => request<Upstream>('/api/v1/admin/upstreams', { method: 'POST', body: JSON.stringify(body) }),

  /**
   * Starts a run in the background (202): a full aggregation takes minutes, so
   * the console polls getUpstreams' syncStatus and reads details from the log.
   */
  syncUpstream: (upstreamId: string) =>
    request<Upstream>(
      `/api/v1/admin/upstreams/${encodeURIComponent(upstreamId)}/sync`,
      { method: 'POST' },
    ),

  getUpstreamSyncRuns: (upstreamId: string) =>
    request<UpstreamSyncRun[]>(
      `/api/v1/admin/upstreams/${encodeURIComponent(upstreamId)}/sync-runs`,
    ),

  // ── Admin user management (Infinia Level · 用户管理) ──

  getAdminUsers: () =>
    request<AdminUser[]>('/api/v1/admin/users'),

  updateAdminUser: (userId: string, body: UpdateAdminUser) =>
    request<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  setListingMinBeeLevel: (listingId: string, minBeeLevel: number) =>
    request<AdminListing>(`/api/v1/admin/listings/${encodeURIComponent(listingId)}/min-bee-level`, {
      method: 'POST',
      body: JSON.stringify({ minBeeLevel }),
    }),

  getAdminListings: (params: { query?: string; after?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.query) search.set('query', params.query);
    if (params.after) search.set('after', params.after);
    if (params.limit) search.set('limit', String(params.limit));
    const qs = search.toString();
    return request<AdminListingPage>(`/api/v1/admin/listings${qs ? `?${qs}` : ''}`);
  },

  // ── Admin remote database configuration (远程数据库配置) ──

  getRemoteDatabases: () =>
    request<RemoteDatabase[]>('/api/v1/admin/databases'),

  createRemoteDatabase: (body: {
    name: string
    jdbcUrl: string
    username: string
    password: string
  }) =>
    request<RemoteDatabase>('/api/v1/admin/databases', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateRemoteDatabase: (
    databaseId: string,
    body: { name?: string; jdbcUrl?: string; username?: string; password?: string },
  ) =>
    request<RemoteDatabase>(`/api/v1/admin/databases/${encodeURIComponent(databaseId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  deleteRemoteDatabase: (databaseId: string) =>
    request<void>(`/api/v1/admin/databases/${encodeURIComponent(databaseId)}`, {
      method: 'DELETE',
    }),

  testRemoteDatabase: (databaseId: string) =>
    request<RemoteDatabaseTestResult>(
      `/api/v1/admin/databases/${encodeURIComponent(databaseId)}/test`,
      { method: 'POST' },
    ),

  setRemoteDatabaseActivation: (databaseId: string, enabled: boolean) =>
    request<RemoteDatabase>(
      `/api/v1/admin/databases/${encodeURIComponent(databaseId)}/activation`,
      { method: 'POST', body: JSON.stringify({ enabled }) },
    ),

  getDataSourceStatus: () =>
    request<DataSourceStatus>('/api/v1/admin/databases/status'),

  // ── Membership purchase (会员等级购买) ──

  getMembershipPlans: () =>
    request<MembershipPlan[]>('/api/v1/membership/plans'),

  getMembershipStatus: () =>
    request<MembershipStatus>('/api/v1/membership/status'),

  createMembershipOrder: (body: { planId: string; channel?: string }) =>
    request<MembershipOrder>('/api/v1/membership/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getMembershipOrder: (orderNo: string) =>
    request<MembershipOrder>(
      `/api/v1/membership/orders/${encodeURIComponent(orderNo)}`,
    ),

  // ── Admin membership console (管理 · 会员套餐) ──

  getAdminMembershipPlans: () =>
    request<AdminMembershipPlan[]>('/api/v1/admin/membership/plans'),

  createAdminMembershipPlan: (body: AdminPlanRequest) =>
    request<AdminMembershipPlan>('/api/v1/admin/membership/plans', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAdminMembershipPlan: (planId: string, body: AdminPlanRequest) =>
    request<AdminMembershipPlan>(
      `/api/v1/admin/membership/plans/${encodeURIComponent(planId)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  deleteAdminMembershipPlan: (planId: string) =>
    request<void>(`/api/v1/admin/membership/plans/${encodeURIComponent(planId)}`, {
      method: 'DELETE',
    }),

  getAdminMembershipOrders: () =>
    request<AdminMembershipOrder[]>('/api/v1/admin/membership/orders'),

  // ── Invitation-only registration (邀请注册) ──

  /** Public — the sign-up form shows an invitation field when required. */
  getRegistrationPolicy: () =>
    request<RegistrationPolicy>('/api/v1/auth/registration-policy'),

  /** The caller's share surface: quota, usage this month, issued codes. */
  getMyInvitations: () =>
    request<MyInvitations>('/api/v1/invitations/mine'),

  /** Mints one code against the caller's monthly quota (admins unlimited). */
  createInvitation: () =>
    request<InvitationCode>('/api/v1/invitations', { method: 'POST' }),

  // ── Admin invitation console (管理 · 邀请码) ──

  getAdminInvitations: () =>
    request<InvitationCode[]>('/api/v1/admin/invitations'),

  /** Issues a code with no level gate and no monthly limit. */
  createAdminInvitation: () =>
    request<InvitationCode>('/api/v1/admin/invitations', { method: 'POST' }),

  /** Current value of the invitation-only registration switch. */
  getAdminRegistrationPolicy: () =>
    request<RegistrationPolicy>('/api/v1/admin/invitations/settings'),

  setAdminRegistrationPolicy: (invitationRequired: boolean) =>
    request<RegistrationPolicy>('/api/v1/admin/invitations/settings', {
      method: 'PUT',
      body: JSON.stringify({ invitationRequired }),
    }),

  // ── Public service status (服务监控页) ──

  getServiceStatus: () => request<ServiceStatus>('/api/v1/status'),

  getServiceIncidents: () =>
    request<ServiceIncident[]>('/api/v1/status/incidents'),

  /** Where /status should hand off to (runtime STORE_MONITOR_PUBLIC_URL). */
  getStatusMonitorLink: () =>
    request<StatusMonitorLink>('/api/v1/status/monitor'),
};

// ---- typed DTO aliases generated from the contract ----
export type Upstream = Partial<components['schemas']['Upstream']> & {
  upstreamId: string
  name: string
  marketplaceUrl: string
  targetNamespace: string
};
export type UpstreamSyncRun = components['schemas']['UpstreamSyncRun'];
export type CatalogItem = components['schemas']['CatalogItem'];
export type CatalogPage = components['schemas']['CatalogPage'];
export type ListingDetail = components['schemas']['ListingDetail'];
export type ListingRelease = components['schemas']['ListingRelease'];
export type ResolveResponse = components['schemas']['ResolveResponse'];
export type DownloadTicket = components['schemas']['DownloadTicket'];
export type PublicUser = components['schemas']['PublicUser'];
export type Library = components['schemas']['Library'];
export type Review = components['schemas']['Review'];
export type PublisherRelease = components['schemas']['PublisherRelease'];
export type UploadSession = components['schemas']['UploadSession'];
export type SubmitResult = components['schemas']['SubmitResult'];
export type RatingsPage = components['schemas']['RatingsPage'];
export type Rating = components['schemas']['Rating'];
export type Report = components['schemas']['Report'];
export type AuditEvent = components['schemas']['AuditEvent'];
export type Organization = components['schemas']['Organization'];
export type OrganizationMember = components['schemas']['OrganizationMember'];
export type Webhook = components['schemas']['Webhook'];
export type InstalledItem = components['schemas']['InstalledItem'];

// ---- membership purchase (会员等级购买) ----
export type MembershipPlan = components['schemas']['MembershipPlan'];
export type MembershipStatus = components['schemas']['MembershipStatus'];
export type MembershipOrder = components['schemas']['MembershipOrder'];
export type AdminMembershipPlan = components['schemas']['AdminMembershipPlan'];
export type AdminMembershipOrder = components['schemas']['AdminMembershipOrder'];
export type AdminPlanRequest = components['schemas']['AdminPlanRequest'];

// ---- invitation-only registration (邀请注册) ----
export type RegistrationPolicy = components['schemas']['RegistrationPolicy'];
export type InvitationCode = components['schemas']['InvitationCode'];
export type MyInvitations = components['schemas']['MyInvitations'];

/** ¥ display for integer fen prices. */
export function formatFen(fen: number): string {
  return `¥${(fen / 100).toLocaleString(undefined, {
    minimumFractionDigits: fen % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---- admin console types (users / curation incl. Infinia Levels) ----
export type AdminUser = {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
  status: string;
  beeLevel: number;
  effectiveBeeLevel: number;
  membershipExpiresAt: string | null;
  mfaEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};
export type UpdateAdminUser = {
  beeLevel?: number;
  status?: string;
  roles?: string[];
  displayName?: string;
};
export type AdminListing = {
  listingId: string;
  coordinate: string;
  name: string;
  type: string;
  status: string;
  visibility: string;
  latestVersion: string | null;
  featured: boolean;
  minBeeLevel: number;
  downloads: number;
};
/** Cursor-paged admin console page — server-side search keeps the response
 * bounded no matter how large the catalog is. */
export type AdminListingPage = {
  items: AdminListing[];
  nextCursor: string | null;
  totalEstimate: number;
};
export type AdminAppUploadStart = components['schemas']['AdminAppUploadStart'];
export type AdminAppUploadSession = components['schemas']['AdminAppUploadSession'];
export type AdminAppRelease = components['schemas']['AdminAppRelease'];
export type RemoteDatabase = {
  databaseId: string;
  name: string;
  jdbcUrl: string;
  username: string;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  createdAt: string;
  updatedAt: string;
};
export type RemoteDatabaseTestResult = {
  ok: boolean;
  productName: string | null;
  productVersion: string | null;
  testedAt: string;
  error: string | null;
};
export type DataSourceStatus = {
  productName: string | null;
  productVersion: string | null;
  url: string | null;
  username: string | null;
  remoteOverrideActive: boolean;
  overrideName: string | null;
};

// ---- public service status page (service monitoring) ----
export type StatusIndicator =
  components['schemas']['StatusIndicator'];
export type ServiceStatus = components['schemas']['StatusPage'];
export type StatusComponentInfo = components['schemas']['StatusComponent'];
export type StatusDayUptime = components['schemas']['StatusDay'];
export type ServiceIncident = components['schemas']['Incident'];
export type StatusMonitorLink = components['schemas']['MonitorLink'];
