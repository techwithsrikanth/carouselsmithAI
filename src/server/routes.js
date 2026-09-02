import express from "express";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { hashPassword, issueToken, verifyPassword, authMiddleware } from "./auth.js";
import { createOtpService, OTP_PURPOSE } from "./auth/otp.js";
import { normalizeEmail, validatePassword, validateSignupEmail } from "./auth/email.js";
import { runCarouselPipeline, runTemplateCarouselPipeline } from "./ai/pipeline.js";
import { buildPromptImproverPrompt } from "./ai/prompts.js";
import { linkedinAuthUrl, instagramAuthUrl } from "./social/providers.js";
import { signOAuthState, verifyOAuthState } from "./social/oauthState.js";
import { publishCarousel } from "./social/publish.js";
import { createZip } from "./utils/zip.js";

function safeGeneratedPath(url, generatedDirs = []) {
  if (!url?.startsWith("/generated/")) return null;
  const filename = path.basename(url);
  for (const generatedDir of generatedDirs) {
    const filePath = path.resolve(generatedDir, filename);
    const root = `${path.resolve(generatedDir)}${path.sep}`;
    if (filePath.startsWith(root) && fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function downloadName(summary, id) {
  return String(summary || `carousel-${id}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || `carousel-${id}`;
}

export function createRouter({ repos, aiClient, config, mailer }) {
  const router = express.Router();
  const otpService = createOtpService({ repos, secret: config.authSecret });

  const publicUser = (user) => ({
    id: user.id,
    email: user.email,
    current_tier: user.current_tier,
    email_verified: Boolean(user.email_verified)
  });

  // Sends a code and reports delivery honestly. When SMTP is not configured the code is
  // logged to the server console instead, and the response says so rather than implying an
  // email is on its way.
  async function sendSignupCode(email) {
    const { code, expiresAtMs } = await otpService.issue({ email, purpose: OTP_PURPOSE.SIGNUP });
    const delivery = await mailer.sendOtp({ to: email, code, ttlMs: otpService.policy.ttlMs });
    return { expiresAtMs, delivered: delivery.delivered, transport: delivery.transport };
  }

  /**
   * Signup does not create a session. It records an unverified account and emails a code;
   * the account stays unusable until /auth/verify-email succeeds, so an address nobody can
   * read never becomes a working account.
   */
  router.post("/auth/signup", async (req, res, next) => {
    try {
      const emailCheck = validateSignupEmail(req.body.email);
      if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.reason });
      const passwordCheck = validatePassword(req.body.password);
      if (!passwordCheck.ok) return res.status(400).json({ error: passwordCheck.reason });
      const email = emailCheck.email;

      const existing = await repos.users.findByEmail(email);
      if (existing?.email_verified) return res.status(409).json({ error: "That email already has an account. Sign in instead." });

      const passwordHash = await hashPassword(passwordCheck.password);
      if (existing) {
        // Unverified account: let the same address retry signup rather than dead-ending.
        await repos.users.replacePassword(existing.id, passwordHash);
      } else {
        await repos.users.create({ email, passwordHash });
      }

      const sent = await sendSignupCode(email);
      res.json({ status: "verification_required", email, ...sent });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "That email already has an account. Sign in instead." });
      next(error);
    }
  });

  router.post("/auth/verify-email", async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const user = await repos.users.findByEmail(email);
      if (!user) return res.status(404).json({ error: "No pending signup for that email." });
      if (user.email_verified) return res.status(409).json({ error: "That email is already verified. Sign in instead." });

      const result = await otpService.verify({ email, purpose: OTP_PURPOSE.SIGNUP, code: req.body.code });
      if (!result.ok) return res.status(400).json({ error: result.reason });

      const verified = await repos.users.markVerified(user.id);
      res.json({ user: publicUser(verified), token: issueToken(verified, config.authSecret) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/resend-code", async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const user = await repos.users.findByEmail(email);
      // Do not disclose whether an unknown address has an account.
      if (!user || user.email_verified) return res.json({ status: "verification_required", email });
      const sent = await sendSignupCode(email);
      res.json({ status: "verification_required", email, ...sent });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/signin", async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const user = await repos.users.findByEmail(email);
      if (!user || !(await verifyPassword(String(req.body.password || ""), user.password_hash))) {
        return res.status(401).json({ error: "Invalid email or password." });
      }
      if (!user.email_verified) {
        // Correct password, unproven address: resume verification instead of issuing a token.
        const sent = await sendSignupCode(email).catch(() => ({}));
        return res.status(403).json({
          error: "Confirm your email address to finish creating this account.",
          status: "verification_required",
          email,
          ...sent
        });
      }
      res.json({ user: publicUser(user), token: issueToken(user, config.authSecret) });
    } catch (error) {
      next(error);
    }
  });

  const requireAuth = authMiddleware(repos, config.authSecret);
  router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));
  router.get("/carousels", requireAuth, async (req, res, next) => {
    try {
      res.json({ carousels: await repos.carousels.listForUser(req.user.id) });
    } catch (error) {
      next(error);
    }
  });
  router.get("/carousels/:id", requireAuth, async (req, res, next) => {
    try {
      const carousel = await repos.carousels.findResultOwned(req.user.id, req.params.id);
      if (!carousel) return res.status(404).json({ error: "Carousel not found." });
      res.json({ carousel });
    } catch (error) {
      next(error);
    }
  });
  router.get("/carousels/:id/download", requireAuth, async (req, res, next) => {
    try {
    const carousel = await repos.carousels.findResultOwned(req.user.id, req.params.id);
    if (!carousel) return res.status(404).json({ error: "Carousel not found." });

    const images = new Map((carousel.images_generated || []).map((image) => [image.slide_number, image]));
    const files = [];
    for (const slide of carousel.slides || []) {
      const image = images.get(slide.slide_number);
      const filePath = safeGeneratedPath(image?.url, [config.generatedDir, config.bundledGeneratedDir]);
      if (!filePath) continue;
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
  router.delete("/carousels/:id", requireAuth, async (req, res, next) => {
    try {
      const deleted = await repos.carousels.deleteOwned(req.user.id, req.params.id);
      if (!deleted) return res.status(404).json({ error: "Carousel not found." });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/carousel/generate", requireAuth, async (req, res, next) => {
    try {
      const result = await runCarouselPipeline({ input: req.body, user: req.user, aiClient, repos, generatedDir: config.generatedDir });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/carousel/template-generate", requireAuth, async (req, res, next) => {
    try {
      const result = await runTemplateCarouselPipeline({ input: req.body, user: req.user, aiClient, repos, generatedDir: config.generatedDir });
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
        carouselId: req.body.carouselId,
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
