import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const schema = `
  CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    current_tier TEXT NOT NULL DEFAULT 'Free / Testing'
  );
  CREATE TABLE IF NOT EXISTS BrandProfiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    company_name TEXT,
    handle TEXT,
    logo_url TEXT,
    custom_style_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS Carousels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    prompt_summary TEXT NOT NULL DEFAULT '',
    artifact_json TEXT NOT NULL DEFAULT '',
    total_slides INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS Slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    carousel_id INTEGER NOT NULL REFERENCES Carousels(id) ON DELETE CASCADE,
    slide_index INTEGER NOT NULL,
    hook_or_body_text TEXT NOT NULL,
    asset_layout_type TEXT NOT NULL,
    visual_mock_data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS SchemaMeta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS EmailOtps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at_ms INTEGER
  );
  CREATE TABLE IF NOT EXISTS SocialConnections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT,
    account_id TEXT,
    account_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, provider)
  );
`;

// Columns added after the original schema shipped. Applied to both drivers on every open.
const addedColumns = [
  ["Carousels", "prompt_summary TEXT NOT NULL DEFAULT ''"],
  ["Carousels", "artifact_json TEXT NOT NULL DEFAULT ''"],
  // public_id is the identifier the API and client use. Row ids restart from whatever
  // snapshot an instance booted with, so two instances can hand the same integer id to
  // different carousels; a UUID makes a stale id resolve to nothing rather than to some
  // other carousel.
  ["Carousels", "public_id TEXT NOT NULL DEFAULT ''"],
  // CURRENT_TIMESTAMP has one-second resolution, leaving history ties that a row id cannot
  // break once ids are no longer monotonic across instances. Sort on epoch millis instead.
  ["Carousels", "created_at_ms INTEGER NOT NULL DEFAULT 0"],
  // An account is unusable until its address is proven by an emailed code. Existing accounts
  // predate the check and are grandfathered in by the backfill below, so nobody is locked out.
  ["Users", "email_verified INTEGER NOT NULL DEFAULT 0"],
  ["Users", "verified_at TEXT"]
];

const indexes = [
  "CREATE UNIQUE INDEX IF NOT EXISTS Carousels_public_id ON Carousels(public_id)",
  "CREATE INDEX IF NOT EXISTS Carousels_user_recent ON Carousels(user_id, created_at_ms DESC, id DESC)",
  "CREATE INDEX IF NOT EXISTS EmailOtps_lookup ON EmailOtps(email, purpose, id DESC)"
];

function statements(sql) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function isDuplicateColumn(error) {
  return String(error?.message || error).includes("duplicate column");
}

/**
 * Local file/in-memory driver. node:sqlite is synchronous; the promises keep one shared
 * async repository API across both drivers.
 */
function createLocalDriver(dbPath) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  const prepare = (sql) => db.prepare(sql);
  const driver = {
    kind: "sqlite",
    async exec(sql) {
      for (const statement of statements(sql)) db.exec(statement);
    },
    async get(sql, params = []) {
      return prepare(sql).get(...params) ?? null;
    },
    async all(sql, params = []) {
      return prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      const result = prepare(sql).run(...params);
      return { lastInsertRowid: Number(result.lastInsertRowid), changes: Number(result.changes) };
    },
    async transaction(fn) {
      db.exec("BEGIN");
      try {
        const value = await fn(driver);
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      db.close();
    }
  };
  return driver;
}

/**
 * Turso/libSQL driver. This is the one that makes deployed storage durable: it is a single
 * shared database rather than a per-instance copy in /tmp.
 */
async function createTursoDriver({ url, authToken }) {
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url, authToken });
  const toRow = (row) => (row ? { ...row } : null);
  const driver = {
    kind: "turso",
    async exec(sql) {
      for (const statement of statements(sql)) await client.execute(statement);
    },
    async get(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return toRow(result.rows[0]) ?? null;
    },
    async all(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows.map(toRow);
    },
    async run(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return { lastInsertRowid: Number(result.lastInsertRowid ?? 0), changes: Number(result.rowsAffected ?? 0) };
    },
    async transaction(fn) {
      const tx = await client.transaction("write");
      const scoped = {
        ...driver,
        async get(sql, params = []) {
          const result = await tx.execute({ sql, args: params });
          return toRow(result.rows[0]) ?? null;
        },
        async all(sql, params = []) {
          const result = await tx.execute({ sql, args: params });
          return result.rows.map(toRow);
        },
        async run(sql, params = []) {
          const result = await tx.execute({ sql, args: params });
          return { lastInsertRowid: Number(result.lastInsertRowid ?? 0), changes: Number(result.rowsAffected ?? 0) };
        }
      };
      try {
        const value = await fn(scoped);
        await tx.commit();
        return value;
      } catch (error) {
        await tx.rollback().catch(() => {});
        throw error;
      }
    },
    close() {
      client.close();
    }
  };
  return driver;
}

async function migrate(db) {
  await db.exec(schema);
  for (const [table, definition] of addedColumns) {
    try {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    } catch (error) {
      if (!isDuplicateColumn(error)) throw error;
    }
  }
  await backfillCarouselIdentity(db);
  await grandfatherExistingUsers(db);
  for (const index of indexes) await db.exec(index);
}

/**
 * Accounts that existed before email verification shipped are marked verified exactly once.
 * Without this every existing user would be locked out by a rule they never had a chance to
 * satisfy. Guarded by a migration marker so it can never re-verify a later unverified signup.
 */
async function grandfatherExistingUsers(db) {
  const key = "grandfathered_email_verification";
  const applied = await db.get("SELECT value FROM SchemaMeta WHERE key = ?", [key]);
  if (applied) return;
  await db.run("UPDATE Users SET email_verified = 1, verified_at = ? WHERE email_verified = 0", [new Date().toISOString()]);
  await db.run("INSERT INTO SchemaMeta (key, value) VALUES (?, ?)", [key, new Date().toISOString()]);
}

async function backfillCarouselIdentity(db) {
  const rows = await db.all("SELECT id, public_id, created_at, created_at_ms FROM Carousels");
  for (const carousel of rows) {
    const publicId = carousel.public_id || crypto.randomUUID();
    // SQLite wrote created_at as UTC text, so parse it as UTC rather than local time.
    const createdAtMs = carousel.created_at_ms || Date.parse(`${String(carousel.created_at).replace(" ", "T")}Z`) || Date.now();
    if (publicId !== carousel.public_id || createdAtMs !== carousel.created_at_ms) {
      await db.run("UPDATE Carousels SET public_id = ?, created_at_ms = ? WHERE id = ?", [publicId, createdAtMs, carousel.id]);
    }
  }
}

/**
 * Opens the durable Turso database when it is configured, otherwise a local SQLite file.
 * Accepts a config object or a plain path so local/in-memory callers stay simple.
 */
export async function openDatabase(options = ":memory:") {
  const config = typeof options === "string" ? { dbPath: options } : options || {};
  const db = config.tursoUrl
    ? await createTursoDriver({ url: config.tursoUrl, authToken: config.tursoAuthToken })
    : createLocalDriver(config.dbPath || ":memory:");
  await migrate(db);
  return db;
}
