import path from "node:path";

export function getConfig(env = process.env) {
  const isVercel = Boolean(env.VERCEL);
  return {
    port: Number(env.PORT || 8787),
    bundledDbPath: path.resolve("data", "app.sqlite"),
    bundledGeneratedDir: path.resolve("generated"),
    dbPath: env.DB_PATH || (isVercel ? "/tmp/carouselsmith.sqlite" : path.resolve("data", "app.sqlite")),
    // When set, storage is the shared Turso database instead of a per-instance SQLite file.
    // This is what makes deployed history durable: /tmp is wiped between cold starts and is
    // never shared between serverless instances.
    tursoUrl: env.TURSO_DATABASE_URL || "",
    tursoAuthToken: env.TURSO_AUTH_TOKEN || "",
    generatedDir: env.GENERATED_DIR || (isVercel ? "/tmp/carouselsmith-generated" : path.resolve("generated")),
    authSecret: env.AUTH_SECRET || env.GEMINI_API_KEY || "dev-only-change-me",
    geminiApiKey: env.GEMINI_API_KEY || "",
    geminiTextModel: env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite",
    geminiImageModel: env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image",
    openaiApiKey: env.OPENAI_API_KEY || "",
    openaiTextModel: env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
    openaiImageModel: env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini",
    textProvider: env.TEXT_PROVIDER || "gemini",
    imageProvider: env.IMAGE_PROVIDER || "gemini",
    imageFallbackProvider: env.IMAGE_FALLBACK_PROVIDER || (env.OPENAI_API_KEY ? "openai" : ""),
    appName: env.APP_NAME || "Carouselsmith AI",
    isProduction: env.NODE_ENV === "production" || Boolean(env.VERCEL),
    smtp: {
      host: env.SMTP_HOST || "",
      port: Number(env.SMTP_PORT || 587),
      // Unset means "infer from the port": 465 is implicit TLS, 587 uses STARTTLS.
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : undefined,
      user: env.SMTP_USER || "",
      password: env.SMTP_PASSWORD || ""
    },
    mailFrom: env.MAIL_FROM || env.SMTP_USER || "",
    appUrl: env.APP_URL || "http://127.0.0.1:5173",
    apiUrl: env.API_URL || "http://127.0.0.1:8787",
    linkedin: {
      clientId: env.LINKEDIN_CLIENT_ID || "",
      clientSecret: env.LINKEDIN_CLIENT_SECRET || "",
      redirectUri: env.LINKEDIN_REDIRECT_URI || ""
    },
    instagram: {
      clientId: env.INSTAGRAM_CLIENT_ID || "",
      clientSecret: env.INSTAGRAM_CLIENT_SECRET || "",
      redirectUri: env.INSTAGRAM_REDIRECT_URI || ""
    }
  };
}
