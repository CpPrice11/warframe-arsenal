CREATE TABLE IF NOT EXISTS catalog_store (
  id TEXT PRIMARY KEY CHECK(id='main'),
  document TEXT NOT NULL CHECK(json_valid(document)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS revisions (
  version INTEGER PRIMARY KEY,
  document TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS backup_catalog_before_update
BEFORE UPDATE OF document ON catalog_store
BEGIN
  INSERT INTO revisions(version,document,created_at) VALUES(OLD.version,OLD.document,OLD.updated_at);
END;
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY,oauth_verifier TEXT NOT NULL,client_challenge TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_codes (code_hash TEXT PRIMARY KEY,client_challenge TEXT NOT NULL,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY,window_start INTEGER NOT NULL,count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS link_checks (id TEXT PRIMARY KEY,url TEXT NOT NULL,status INTEGER,checked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots (created_at TEXT PRIMARY KEY,version INTEGER NOT NULL,document TEXT NOT NULL);
