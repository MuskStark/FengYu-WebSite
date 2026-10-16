import { lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './stores/auth';
import RouteContent from './components/RouteContent';

/** Routes with code splitting and role-aware guards (design §12.2). */
const IntroductionView = lazy(() => import('./intro/app/page'));
const DocsView = lazy(() => import('./intro/docs/DocsView'));
const DocsEntryRedirect = lazy(() => import('./intro/docs/DocsView').then(m => ({ default: m.DocsEntryRedirect })));
const DiscoverView = lazy(() => import('./views/DiscoverView'));
const BrowseView = lazy(() => import('./views/BrowseView'));
const ListingDetailView = lazy(() => import('./views/ListingDetailView'));
const LibraryView = lazy(() => import('./views/LibraryView'));
const AccountView = lazy(() => import('./views/AccountView'));
const MembershipView = lazy(() => import('./views/MembershipView'));
const MembershipResultView = lazy(() => import('./views/MembershipResultView'));
const OrganizationsView = lazy(() => import('./views/OrganizationsView'));
const AdminView = lazy(() => import('./views/AdminView'));
const PublisherView = lazy(() => import('./views/PublisherView'));
const ReviewView = lazy(() => import('./views/ReviewView'));
const StatusRedirectView = lazy(() => import('./views/StatusRedirectView'));
const SignInView = lazy(() => import('./views/SignInView'));
const CallbackView = lazy(() => import('./views/CallbackView'));
const NotFoundView = lazy(() => import('./views/NotFoundView'));

/**
 * Role-aware guard. Mirrors the old router.beforeEach: the session is loaded
 * once (auth.ready), unauthenticated users land on /signin with a redirect
 * target, and users without any of the required roles fall back to Discover.
 */
function RequireAuth({ roles, children }: { roles?: string[]; children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  // The store load is triggered by the shell (useBootstrapAuth); guards only
  // observe `ready` so every route change stays synchronous.
  if (!auth.ready) {
    // Neutral session-loading skeleton — never sensitive data, never a blank
    // flash while the stored session is being verified (plan §5).
    return (
      <div className="page-shell py-16" aria-busy="true" aria-live="polite">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-muted" />
        <div className="mt-6 h-32 animate-pulse rounded-2xl bg-surface-muted" />
      </div>
    );
  }
  if (!auth.isAuthenticated) {
    const target = location.pathname + location.search;
    return <Navigate to={`/store/signin?redirect=${encodeURIComponent(target)}`} replace />;
  }
  const required = roles ?? [];
  if (required.length > 0 && !required.some((role) => auth.roles.includes(role))) {
    return <Navigate to="/store" replace />;
  }
  return <>{children}</>;
}

function LegacyRoute() {
  const location = useLocation();
  const destination = /^\/site\/?$/.test(location.pathname) ? '/' : `/store${location.pathname}`;
  return <Navigate to={destination + location.search + location.hash} replace />;
}

export function RouterTree() {
  return (
    <RouteContent>
      <Routes>
        <Route path="/store" element={<DiscoverView />} />
        <Route path="/" element={<IntroductionView />} />
        {/* Self-hosted documentation — content vendored from the FengYu repo. */}
        <Route path="/docs" element={<DocsEntryRedirect />} />
        <Route path="/docs/*" element={<DocsView />} />
        <Route path="/store/browse" element={<BrowseView />} />
        {/* The listing detail reads namespace/slug straight off the match so
            both props stay in sync with the URL (old `props: true`). */}
        <Route path="/store/listing/:namespace/:slug" element={<ListingDetailView />} />
        <Route
          path="/store/library"
          element={
            <RequireAuth>
              <LibraryView />
            </RequireAuth>
          }
        />
        <Route
          path="/store/account"
          element={
            <RequireAuth>
              <AccountView />
            </RequireAuth>
          }
        />
        <Route
          path="/store/membership"
          element={
            <RequireAuth>
              <MembershipView />
            </RequireAuth>
          }
        />
        {/* Where the payment gateway's return_url lands (orderNo in the query). */}
        <Route
          path="/store/membership/result"
          element={
            <RequireAuth>
              <MembershipResultView />
            </RequireAuth>
          }
        />
        <Route
          path="/store/organizations"
          element={
            <RequireAuth>
              <OrganizationsView />
            </RequireAuth>
          }
        />
        <Route
          path="/store/admin"
          element={
            <RequireAuth roles={['PLATFORM_ADMIN']}>
              <AdminView />
            </RequireAuth>
          }
        />
        <Route
          path="/store/publisher"
          element={
            <RequireAuth roles={['PUBLISHER', 'ORG_ADMIN', 'REVIEWER', 'PLATFORM_ADMIN']}>
              <PublisherView />
            </RequireAuth>
          }
        />
        <Route
          path="/store/review"
          element={
            <RequireAuth roles={['REVIEWER', 'PLATFORM_ADMIN']}>
              <ReviewView />
            </RequireAuth>
          }
        />
        <Route path="/store/status" element={<StatusRedirectView />} />
        <Route path="/store/signin" element={<SignInView />} />
        <Route path="/store/callback" element={<CallbackView />} />
        {['site', 'browse', 'listing/*', 'library', 'account', 'membership/*', 'organizations', 'admin', 'publisher', 'review', 'status', 'signin', 'callback'].map(path => (
          <Route key={path} path={`/${path}`} element={<LegacyRoute />} />
        ))}
        <Route path="*" element={<NotFoundView />} />
      </Routes>
    </RouteContent>
  );
}
