import express from "express";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { hashPassword, issueToken, verifyPassword, authMiddleware } from "./auth.js";
import { runCarouselPipeline } from "./ai/pipeline.js";
import { buildPromptImproverPrompt } from "./ai/prompts.js";
import { linkedinAuthUrl, instagramAuthUrl } from "./social/providers.js";
import { signOAuthState, verifyOAuthState } from "./social/oauthState.js";
import { publishCarousel } from "./social/publish.js";
import { createZip } from "./utils/zip.js";

function safeGeneratedPath(url, generatedDir = path.resolve("generated")) {
  if (!url?.startsWith("/generated/")) return null;
  const filename = path.basename(url);
  const filePath = path.resolve(generatedDir, filename);
  const root = `${path.resolve(generatedDir)}${path.sep}`;
  return filePath.startsWith(root) ? filePath : null;
}

function downloadName(summary, id) {
  return String(summary || `carousel-${id}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || `carousel-${id}`;
}

export function createRouter({ repos, aiClient, config }) {
  const router = express.Router();

  router.post("/auth/signup", async (req, res, next) => {
    try {
      const email = String(req.body.email || "").toLowerCase().trim();
      const password = String(req.body.password || "");
      if (!email || password.length < 8) return res.status(400).json({ error: "Email and an 8+ character password are required." });
      const user = repos.users.create({ email, passwordHash: await hashPassword(password) });
      res.json({ user: { id: user.id, email: user.email, current_tier: user.current_tier }, token: issueToken(user, config.authSecret) });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "Email already exists." });
      next(error);
    }
  });

  router.post("/auth/signin", async (req, res) => {
    const email = String(req.body.email || "").toLowerCase().trim();
    const user = repos.users.findByEmail(email);
    if (!user || !(await verifyPassword(String(req.body.password || ""), user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }
    res.json({ user: { id: user.id, email: user.email, current_tier: user.current_tier }, token: issueToken(user, config.authSecret) });
  });

  const requireAuth = authMiddleware(repos, config.authSecret);
  router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));
  router.get("/carousels", requireAuth, (req, res) => res.json({ carousels: repos.carousels.listForUser(req.user.id) }));
  router.get("/carousels/:id", requireAuth, (req, res) => {
    const carousel = repos.carousels.findResultOwned(req.user.id, Number(req.params.id));
    if (!carousel) return res.status(404).json({ error: "Carousel not found." });
    res.json({ carousel });
  });
  router.get("/carousels/:id/download", requireAuth, async (req, res, next) => {
    try {
    const carousel = repos.carousels.findResultOwned(req.user.id, Number(req.params.id));
    if (!carousel) return res.status(404).json({ error: "Carousel not found." });

    const images = new Map((carousel.images_generated || []).map((image) => [image.slide_number, image]));
    const files = [];
    for (const slide of carousel.slides || []) {
      const image = images.get(slide.slide_number);
      const filePath = safeGeneratedPath(image?.url);
      if (!filePath || !fs.existsSync(filePath)) continue;
      const slidePng = await sharp(filePath)
        .resize(1080, 1350, { fit: "cover", background: "#fffdfa" })
        .png()
        .toBuffer();
      files.push({
        name: `slide-${String(slide.slide_number).padStart(2, "0")}.png`,
        data: slidePng
      });
    }

    const caption = `${carousel.caption || ""}\n\n${(carousel.hashtags || []).join(" ")}`.trim();
    if (caption) files.push({ name: "caption.txt", data: Buffer.from(caption, "utf8") });
    if (!files.length) return res.status(404).json({ error: "No generated slide files were found for this carousel." });

    const zip = createZip(files);
    res.setHeader("content-type", "application/zip");
    res.setHeader("content-disposition", `attachment; filename="${downloadName(carousel.prompt_summary, carousel.carousel_id)}.zip"`);
    res.send(zip);
    } catch (error) {
      next(error);
    }
  });
  router.delete("/carousels/:id", requireAuth, (req, res) => {
    const deleted = repos.carousels.deleteOwned(req.user.id, Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: "Carousel not found." });
    res.json({ ok: true });
  });

  router.post("/carousel/generate", requireAuth, async (req, res, next) => {
    try {
      const result = await runCarouselPipeline({ input: req.body, user: req.user, aiClient, repos });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/prompt/improve", requireAuth, async (req, res, next) => {
    try {
      const prompt = String(req.body.prompt || "").trim();
      if (prompt.length < 8) return res.status(400).json({ error: "Add a little more topic detail before improving the prompt." });
      const response = await aiClient.generateJson(buildPromptImproverPrompt({
        prompt,
        instagramHandle: req.body.instagramHandle || "",
        sourceText: req.body.sourceText || "",
        totalSlides: req.body.totalSlides
      }));
      const improved = String(response.json.improved_prompt || "").trim();
      if (!improved) return res.status(502).json({ error: "AI did not return an improved prompt." });
      res.json({ improved_prompt: improved });
    } catch (error) {
      next(error);
    }
  });

  router.get("/oauth/:provider/start", requireAuth, (req, res) => {
    const provider = req.params.provider;
    const state = signOAuthState({ userId: req.user.id, provider }, config.authSecret);
    if (provider === "linkedin") {
      if (!config.linkedin.clientId || !config.linkedin.redirectUri) return res.status(503).json({ error: "LinkedIn OAuth is not configured." });
      return res.json({ url: linkedinAuthUrl({ ...config.linkedin, state }) });
    }
    if (provider === "instagram") {
      if (!config.instagram.clientId || !config.instagram.redirectUri) return res.status(503).json({ error: "Instagram OAuth is not configured." });
      return res.json({ url: instagramAuthUrl({ ...config.instagram, state }) });
    }
    res.status(404).json({ error: "Unknown provider." });
  });

  router.get("/oauth/:provider/callback", (req, res) => {
    const state = verifyOAuthState(req.query.state, config.authSecret);
    if (!state || state.provider !== req.params.provider) return res.status(400).send("Invalid OAuth state.");
    res.redirect(`${config.appUrl}/dashboard?oauth=${req.params.provider}&status=received`);
  });

  router.post("/publish", requireAuth, async (req, res, next) => {
    try {
      const result = await publishCarousel({
        repos,
        userId: req.user.id,
        carouselId: Number(req.body.carouselId),
        platforms: req.body.platforms || [],
        caption: req.body.caption || "",
        config
      });
      res.json({ results: result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
