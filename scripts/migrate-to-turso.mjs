/**
 * Copies the local SQLite database into the configured Turso database.
 *
 *   node --env-file-if-exists=.env scripts/migrate-to-turso.mjs [sourcePath]
 *
 * Idempotent: users are matched by email and carousels by public_id, so re-running it does
 * not duplicate rows. Existing Turso rows are never deleted or overwritten.
 */
import path from "node:path";
import { getConfig } from "../src/server/config.js";
import { openDatabase } from "../src/server/db.js";

const config = getConfig();
if (!config.tursoUrl) {
  console.error("TURSO_DATABASE_URL is not set. Nothing to migrate into.");
  process.exit(1);
}

const sourcePath = process.argv[2] || path.resolve("data", "app.sqlite");
const source = await openDatabase({ dbPath: sourcePath });
const target = await openDatabase({ tursoUrl: config.tursoUrl, tursoAuthToken: config.tursoAuthToken });

const users = await source.all("SELECT * FROM Users ORDER BY id");
const carousels = await source.all("SELECT * FROM Carousels ORDER BY id");

let copiedUsers = 0;
let copiedCarousels = 0;
let skippedCarousels = 0;
const userIdByEmail = new Map();

for (const user of users) {
  const existing = await target.get("SELECT id FROM Users WHERE email = ?", [user.email]);
  if (existing) {
    userIdByEmail.set(user.email, existing.id);
    continue;
  }
  const result = await target.run(
    "INSERT INTO Users (email, password_hash, created_at, current_tier) VALUES (?, ?, ?, ?)",
    [user.email, user.password_hash, user.created_at, user.current_tier]
  );
  userIdByEmail.set(user.email, Number(result.lastInsertRowid));
  copiedUsers += 1;
}

const emailByLocalId = new Map(users.map((user) => [user.id, user.email]));

for (const carousel of carousels) {
  const existing = await target.get("SELECT id FROM Carousels WHERE public_id = ?", [carousel.public_id]);
  if (existing) {
    skippedCarousels += 1;
    continue;
  }
  const ownerEmail = emailByLocalId.get(carousel.user_id);
  const ownerId = ownerEmail ? userIdByEmail.get(ownerEmail) : null;
  if (!ownerId) {
    skippedCarousels += 1;
    continue;
  }
  const slides = await source.all("SELECT * FROM Slides WHERE carousel_id = ? ORDER BY slide_index", [carousel.id]);
  await target.transaction(async (tx) => {
    const result = await tx.run(
      `INSERT INTO Carousels (user_id, prompt, prompt_summary, artifact_json, total_slides, created_at, public_id, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ownerId,
        carousel.prompt,
        carousel.prompt_summary,
        carousel.artifact_json,
        carousel.total_slides,
        carousel.created_at,
        carousel.public_id,
        carousel.created_at_ms
      ]
    );
    const carouselId = Number(result.lastInsertRowid);
    for (const slide of slides) {
      await tx.run(
        "INSERT INTO Slides (carousel_id, slide_index, hook_or_body_text, asset_layout_type, visual_mock_data) VALUES (?, ?, ?, ?, ?)",
        [carouselId, slide.slide_index, slide.hook_or_body_text, slide.asset_layout_type, slide.visual_mock_data]
      );
    }
  });
  copiedCarousels += 1;
}

const totals = {
  users: (await target.get("SELECT COUNT(*) AS n FROM Users")).n,
  carousels: (await target.get("SELECT COUNT(*) AS n FROM Carousels")).n,
  slides: (await target.get("SELECT COUNT(*) AS n FROM Slides")).n
};

console.log(`source: ${sourcePath}`);
console.log(`copied ${copiedUsers} users, ${copiedCarousels} carousels (${skippedCarousels} already present)`);
console.log(`turso now holds: ${totals.users} users, ${totals.carousels} carousels, ${totals.slides} slides`);

source.close();
target.close();
