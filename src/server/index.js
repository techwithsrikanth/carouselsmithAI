import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { createRepositories } from "./repositories.js";
import { createMailer } from "./email/mailer.js";
import { createGeminiClient } from "./ai/geminiClient.js";
import { createRouter } from "./routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function seedVercelDatabase(config) {
  // Only relevant to the per-instance SQLite fallback. With Turso configured the database is
  // shared and durable, so there is nothing to seed and nothing to lose on a cold start.
  if (!process.env.VERCEL || config.tursoUrl) return;
  if (config.dbPath === config.bundledDbPath || fs.existsSync(config.dbPath) || !fs.existsSync(config.bundledDbPath)) return;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  fs.copyFileSync(config.bundledDbPath, config.dbPath);
}

export async function createApp(config = getConfig()) {
  seedVercelDatabase(config);
  const db = await openDatabase(config);
  const repos = createRepositories(db);
  const mailer = await createMailer(config);
  const aiClient = createGeminiClient(config.geminiApiKey, {
    textModel: config.geminiTextModel,
    imageModel: config.geminiImageModel,
    openaiApiKey: config.openaiApiKey,
    openaiTextModel: config.openaiTextModel,
    openaiImageModel: config.openaiImageModel,
    textProvider: config.textProvider,
    imageProvider: config.imageProvider,
    imageFallbackProvider: config.imageFallbackProvider
  });
  const app = express();
  app.use(express.json({ limit: "60mb" }));
  app.use("/generated", express.static(config.generatedDir));
  if (config.generatedDir !== config.bundledGeneratedDir) {
    app.use("/generated", express.static(config.bundledGeneratedDir));
  }
  app.use("/api", createRouter({ repos, aiClient, config, mailer }));
  app.use(express.static(path.resolve(__dirname, "..", "..", "dist")));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.message || "Unexpected server error" });
  });
  return { app, db, repos, mailer };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = getConfig();
  const { app, db } = await createApp(config);
  app.listen(config.port, "127.0.0.1", () => {
    console.log(`Carouselsmith API listening on http://127.0.0.1:${config.port} (storage: ${db.kind})`);
  });
}
