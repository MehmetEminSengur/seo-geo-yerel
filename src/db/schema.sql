-- seo-geo-yerel şeması. Her değişiklik migrate.mjs içindeki sürüm listesine eklenir.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Platformdan okunan sayfalar: ürün, kategori (collection) ve blog yazısı.
CREATE TABLE IF NOT EXISTS pages (
  id               TEXT PRIMARY KEY,            -- <platform>:<type>:<external_id>
  platform         TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('product','collection','article')),
  external_id      TEXT NOT NULL,
  handle           TEXT,
  title            TEXT,
  url              TEXT,
  parent_handle    TEXT,
  menu_path        TEXT,                        -- "Ambalaj > Folyolar" gibi
  family           TEXT,                        -- ürün ailesi anahtarı (eşleme kapısı)
  body_html        TEXT,
  seo_title        TEXT,
  seo_description  TEXT,
  content_hash     TEXT,                        -- canonicalHash(body, seo_title, seo_description)
  image_url        TEXT,
  target_keyword   TEXT,                        -- tek sahip kuralı: bir kelime tek sayfaya
  raw_json         TEXT,
  platform_updated_at TEXT,
  synced_at        TEXT NOT NULL,
  last_applied_at  TEXT,                        -- 42 gün kilidi buradan okunur
  lifecycle        TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(type, lifecycle);

CREATE TABLE IF NOT EXISTS keywords (
  id              INTEGER PRIMARY KEY,
  keyword         TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL,                -- autocomplete | dataforseo | gsc | manual
  volume          INTEGER,
  serp_page_type  TEXT,                         -- product | collection | article | mixed
  intent          TEXT,                         -- transactional | product | informational
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','rejected')),
  reject_reason   TEXT,
  page_id         TEXT REFERENCES pages(id),    -- eşlendiği tek sayfa (ya da NULL = blog adayı)
  fetched_at      TEXT NOT NULL
);

-- Her sayfa değişikliği bir iş; durum makinesi src/core/jobs.mjs içinde.
CREATE TABLE IF NOT EXISTS jobs (
  id               INTEGER PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('update_page','create_article')),
  page_id          TEXT,
  target_keyword   TEXT,
  state            TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  lease_owner      TEXT,
  lease_until      TEXT,
  last_error       TEXT,
  draft_json       TEXT,                        -- üretilen taslak
  draft_hash       TEXT,
  intended_hash    TEXT,                        -- platforma yazılacak içeriğin özeti
  backup_id        INTEGER REFERENCES backups(id),
  result_json      TEXT,                        -- platformun döndüğü kimlik vb.
  idempotency_key  TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state, lease_until);

CREATE TABLE IF NOT EXISTS job_events (
  id         INTEGER PRIMARY KEY,
  job_id     INTEGER NOT NULL REFERENCES jobs(id),
  from_state TEXT,
  to_state   TEXT NOT NULL,
  note       TEXT,
  at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  id           INTEGER PRIMARY KEY,
  page_id      TEXT NOT NULL,
  job_id       INTEGER,
  file_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_state (
  task            TEXT PRIMARY KEY,
  last_started_at TEXT,
  last_success_at TEXT,
  last_error      TEXT
);

CREATE TABLE IF NOT EXISTS budget_ledger (
  id          INTEGER PRIMARY KEY,
  provider    TEXT NOT NULL,
  amount_usd  REAL NOT NULL DEFAULT 0,
  units       INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  provider      TEXT PRIMARY KEY,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY,
  command     TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT,
  summary     TEXT
);
