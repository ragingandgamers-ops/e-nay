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
 mother_id TEXT NOT NULL REFERENCES accounts(id), created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS companion_links_mother ON companion_links(mother_id);
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


export const MAX_COMPANIONS=3;
// Older deployments made mother_id UNIQUE. Copy and replace that table in one
// transaction; retain every existing pairing and leave all care records alone.
// Concurrent initializations repeat a complete copy rather than dropping rows.
export async function migrateCompanions(db){
 const table=await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='companion_links'").first();
 if(!/mother_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(table?.sql??''))return;
 await db.batch([
  db.prepare("CREATE TABLE IF NOT EXISTS companion_links_migration (father_id TEXT PRIMARY KEY REFERENCES accounts(id),mother_id TEXT NOT NULL REFERENCES accounts(id),created_at INTEGER NOT NULL)"),
  db.prepare("INSERT INTO companion_links_migration(father_id,mother_id,created_at) SELECT father_id,mother_id,created_at FROM companion_links"),
  db.prepare("DROP TABLE companion_links"),
  db.prepare("ALTER TABLE companion_links_migration RENAME TO companion_links"),
  db.prepare("CREATE INDEX IF NOT EXISTS companion_links_mother ON companion_links(mother_id)")
 ]);
}
