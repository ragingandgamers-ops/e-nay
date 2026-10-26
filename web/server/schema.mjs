export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'patient' CHECK(role IN ('patient','staff')),
 active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS family_accounts (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 kind TEXT NOT NULL CHECK(kind IN ('mother','father')),
 maternal_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS companion_links (
 father_id TEXT PRIMARY KEY REFERENCES accounts(id),
 mother_id TEXT NOT NULL UNIQUE REFERENCES accounts(id), created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pairing_codes (
 mother_id TEXT PRIMARY KEY REFERENCES accounts(id),
 code_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 proof_hash TEXT PRIMARY KEY, device_hash TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS patient_links (
 account_id TEXT NOT NULL REFERENCES accounts(id), patient_id TEXT NOT NULL,
 PRIMARY KEY(account_id,patient_id)
);
CREATE TABLE IF NOT EXISTS workspace (
 id TEXT PRIMARY KEY, revision TEXT NOT NULL, body TEXT NOT NULL,
 last_operation TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_operations (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, revision TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS record_sync_maps (
 operation_id TEXT PRIMARY KEY, map_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_limits (
 bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, resets_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trash_entries (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL,
 deleted_by TEXT NOT NULL, deleted_at INTEGER NOT NULL, restored_at INTEGER
);
CREATE TABLE IF NOT EXISTS profile_reservations (
 profile_id TEXT PRIMARY KEY, trash_id TEXT NOT NULL REFERENCES trash_entries(id)
);
CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, action TEXT NOT NULL,
 revision TEXT, created_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO workspace(id,revision,body,updated_at)
VALUES('clinic','initial','{"mothers":[],"children":[],"visits":[],"vaccines":[],"growth":[],"inventory":[]}',0);
`;
