import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(dbPath = ":memory:") {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
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
  `);
  try {
    db.exec("ALTER TABLE Carousels ADD COLUMN prompt_summary TEXT NOT NULL DEFAULT ''");
  } catch (error) {
    if (!String(error.message).includes("duplicate column")) throw error;
  }
  try {
    db.exec("ALTER TABLE Carousels ADD COLUMN artifact_json TEXT NOT NULL DEFAULT ''");
  } catch (error) {
    if (!String(error.message).includes("duplicate column")) throw error;
  }
  return db;
}

export function inTransaction(db, fn) {
  db.exec("BEGIN");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
