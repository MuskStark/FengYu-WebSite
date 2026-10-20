// k6 load test for the admin plugin-management console.
//
//   docker compose -f docker-compose.yml -f docker-compose.loadtest.yml \
//     --profile app run --rm k6 run - < scripts/tests/loadtest/admin-listing.js
//
// Two scenarios against the same seeded catalog:
//   single_admin — one admin opens the console (per-request latency of
//                  GET /api/v1/admin/listings, the page that "freezes")
//   concurrent   — a burst of admins/browse traffic; shows how the N+1 admin
//                  request starves the shared Tomcat/Hikari pools and drags
//                  the (SQL-pushed-down) catalog browse down with it.
//
import http from 'k6/http';
import { check, group } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://store:8080';

const adminListings = new Trend('admin_listings_ms');
const catalogBrowse = new Trend('catalog_browse_ms');

export const options = {
  // NOTE: no discardResponseBodies — setup() parses the login response body.
  scenarios: {
    single_admin: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 3,
      gracefulStop: '10m',
      exec: 'adminConsole',
    },
    concurrent: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '30s', target: 10 },
      ],
      gracefulStop: '5m',
      startTime: '60s',
      exec: 'mixed',
    },
  },
};

export function setup() {
  const res = http.post(`${BASE}/api/v1/auth/login`,
    JSON.stringify({ email: 'admin@infinia.local', password: 'Password123!' }),
    { headers: { 'Content-Type': 'application/json' } });
  if (res.status !== 200) {
    throw new Error(`login failed: HTTP ${res.status} ${res.body}`);
  }
  return { token: res.json('accessToken') };
}

export function adminConsole(data) {
  group('GET /api/v1/admin/listings', () => {
    const res = http.get(`${BASE}/api/v1/admin/listings`, {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    adminListings.add(res.timings.duration);
    check(res, { 'admin listings 200': (r) => r.status === 200 });
  });
}

export function mixed(data) {
  group('GET /api/v1/admin/listings', () => {
    const res = http.get(`${BASE}/api/v1/admin/listings`, {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    adminListings.add(res.timings.duration);
    check(res, { 'admin listings 200': (r) => r.status === 200 });
  });
  group('GET /api/v1/catalog?type=PLUGIN', () => {
    const res = http.get(`${BASE}/api/v1/catalog?type=PLUGIN`);
    catalogBrowse.add(res.timings.duration);
    check(res, { 'catalog 200': (r) => r.status === 200 });
  });
}
