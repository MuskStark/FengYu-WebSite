-- Seed N synthetic PLUGIN listings for the admin plugin-management load test.
-- Usage:
--   docker compose exec -T postgres psql -U store -d store \
--     -v n=3000 -f - < scripts/tests/loadtest/seed-plugins.sql
--
-- Direct SQL on purpose: the publish pipeline (upload → scan → review) is
-- orders of magnitude slower than the page under test and adds nothing to the
-- admin console's query shape (listing + i18n + release rows is all it reads).
--
-- Postgres data-modifying CTEs cannot see each other's rows through table
-- scans, so every stage feeds the next through RETURNING.

DELETE FROM listing WHERE namespace = 'loadtest';
DELETE FROM namespace WHERE name = 'loadtest';

WITH pub AS (
  SELECT id AS publisher_id FROM store_user
  WHERE email_normalized = 'publisher@infinia.local'
), ns AS (
  INSERT INTO namespace (id, name, owner_user_id, verified, created_at)
  SELECT gen_random_uuid(), 'loadtest', pub.publisher_id, TRUE, now() FROM pub
  RETURNING id
), li AS (
  INSERT INTO listing (id, namespace_id, namespace, slug, type, visibility, status,
      category, default_channel, publisher_user_id, downloads, favorite_count,
      created_at, updated_at)
  SELECT gen_random_uuid(), ns.id, 'loadtest', 'load-plugin-' || g, 'PLUGIN', 'PUBLIC',
      'ACTIVE', 'Productivity', 'STABLE', pub.publisher_id, (g % 997), 0, now(), now()
  FROM generate_series(1, :n) AS g CROSS JOIN ns CROSS JOIN pub
  RETURNING id, slug
), i18n AS (
  INSERT INTO listing_i18n (listing_id, locale, name, summary, description_md, changelog_md)
  SELECT id, 'en', 'Load Plugin ' || slug,
      'Synthetic plugin seeded for the admin-listing load test', NULL, NULL
  FROM li
  RETURNING listing_id
)
INSERT INTO release (id, listing_id, version, status, channel, published_at,
    created_at, rollout_percent)
SELECT gen_random_uuid(), listing_id, '1.0.0', 'PUBLISHED', 'STABLE', now(), now(), 100
FROM i18n;
