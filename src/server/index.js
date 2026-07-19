import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { createRepositories } from "./repositories.js";
import { createGeminiClient } from "./ai/geminiClient.js";
import { createRouter } from "./routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(config = getConfig()) {
  const db = openDatabase(config.dbPath);
  const repos = createRepositories(db);
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
  app.use("/api", createRouter({ repos, aiClient, config }));
  app.use(express.static(path.resolve(__dirname, "..", "..", "dist")));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.message || "Unexpected server error" });
  });
  return { app, db, repos };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = getConfig();
  const { app } = createApp(config);
  app.listen(config.port, "127.0.0.1", () => {
    console.log(`Carouselsmith API listening on http://127.0.0.1:${config.port}`);
  });
}
