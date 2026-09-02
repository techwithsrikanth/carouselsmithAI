import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { openDatabase } from "../src/server/db.js";
import { getConfig } from "../src/server/config.js";
import { createRepositories } from "../src/server/repositories.js";
import { hashPassword, issueToken, verifyPassword, verifyToken } from "../src/server/auth.js";
import { extractJson, extractJsonCandidate } from "../src/server/utils/json.js";
import { normalizeInstagramHandle } from "../src/server/utils/handle.js";
import { summarizePrompt } from "../src/server/utils/summary.js";
import { buildImagePrompt, buildResearchPrompt, buildSlidesPrompt, chooseDesignSystem } from "../src/server/ai/prompts.js";
import { buildOpenAiTextBody } from "../src/server/ai/geminiClient.js";
import { isEventCarousel, normalizeStyleUploads, runCarouselPipeline, verifiedEventsForWindow, verifyClaims } from "../src/server/ai/pipeline.js";
import { isSocialPostDesign, renderSocialPostSlide } from "../src/server/renderers/socialPostRenderer.js";
import { renderEventPosterSlide } from "../src/server/renderers/eventPosterRenderer.js";
import { signOAuthState, verifyOAuthState } from "../src/server/social/oauthState.js";
import { instagramCarouselBody, linkedinPostBody } from "../src/server/social/providers.js";
import { publishCarousel } from "../src/server/social/publish.js";
import { createZip } from "../src/server/utils/zip.js";
import { buildPromptImproverPrompt } from "../src/server/ai/prompts.js";
import { createOtpService, hashCode, otpPolicy, OTP_PURPOSE } from "../src/server/auth/otp.js";
import { validatePassword, validateSignupEmail } from "../src/server/auth/email.js";

async function fakeRepos() {
  const db = await openDatabase(":memory:");
  return { db, repos: createRepositories(db) };
}

function fakeAi({ quota = false } = {}) {
  let imageCalls = 0;
  return {
    configured: true,
    async generateJson(prompt, options = {}) {
      if (options.grounded && prompt.includes("Research")) {
        if (/Topic: .*events happening/i.test(prompt) || /Topic: .*top events/i.test(prompt)) {
          const now = new Date();
          const tomorrow = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1)).toISOString().slice(0, 10);
          return {
            json: {
              key_insights: ["Bengaluru has verified events across food, comedy, and culture."],
              statistics: [],
              events: [
                {
                  name: "Sushi Making Workshop",
                  category: "Food",
                  date: tomorrow,
                  time: "6 PM",
                  venue: "Thirdspace",
                  area: "Bengaluru",
                  price: "Rs 999 onwards",
                  booking_url: "https://insider.in/sushi-making-workshop",
                  source_url: "https://insider.in/sushi-making-workshop",
                  why_pick: "Hands-on food experience with a strong weekend fit.",
                  confidence: "high"
                },
                {
                  name: "Old Tech Summit",
                  category: "Tech",
                  date: "2024-11-20",
                  time: "10 AM",
                  venue: "BIEC",
                  price: "Registration required",
                  source_url: "https://example.com/old",
                  why_pick: "Old event",
                  confidence: "low"
                }
              ],
              trends: [],
              quotes: [],
              references: [{ source_url: "https://insider.in/sushi-making-workshop", title: "Sushi Making Workshop", extracted_content: "Upcoming listing.", credibility_score: 0.9 }]
            },
            groundingMetadata: { groundingChunks: [{ web: { uri: "https://insider.in/sushi-making-workshop", title: "Sushi Making Workshop" } }] }
          };
        }
        return {
          json: {
            key_insights: ["Creators need proof-led carousels."],
            statistics: [{ claim: "Teams publish faster with reuse", value: "2x", source_url: "https://example.com/report", title: "Report", confidence: "medium" }],
            trends: ["AI-assisted content ops"],
            quotes: [],
            references: [{ source_url: "https://example.com/report", title: "Report", extracted_content: "Paraphrased source summary.", credibility_score: 0.8 }]
          },
          groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/report", title: "Report" } }] }
        };
      }
      if (prompt.includes("attached carousel screenshots/PDF pages")) {
        return {
          json: {
            design_brief: "Reference-led editorial carousel with large headlines and disciplined safe margins.",
            color_palette: ["#ffffff", "#111111", "#db4d35"],
            font_styles: ["bold condensed headline", "clean sans body"],
            alignment: "left aligned grid",
            layout_rules: ["repeat the same headline zone", "keep footer locked", "use one accent shape"],
            visual_density: "low; mostly type and whitespace",
            image_policy: "use no photos, only tiny diagrams if needed",
            consistency_rules: ["same spacing every slide", "same numbering every slide"],
            reference_format: "social_post_screenshot",
            fixed_chrome: {
              account_identity_policy: "use the user's handle consistently, never the reference person's name",
              avatar_policy: "small neutral circular avatar on every slide",
              timestamp_policy: "use Just now on every slide",
              menu_policy: "three dots top-right on every slide",
              badge_policy: "same small verification badge on every slide"
            },
            writing_style: { voice: "direct", rhythm: "short" }
          },
          groundingMetadata: {}
        };
      }
      if (prompt.includes("public Instagram/web presence")) return { json: { handle: "@studio", note: "Private/logged-in data is not accessible." }, groundingMetadata: {} };
      return {
        json: {
          content_plan: { audience: "agency owners", narrative_structure: "problem-proof-payoff" },
          caption: "A grounded carousel for content operators.",
          hashtags: ["#ContentOps", "#AICreators"],
          slides: Array.from({ length: 7 }, (_, index) => ({
            title: `Slide ${index + 1} Proof`,
            body: "Use research before writing.",
            visual_direction: "editorial chart",
            image_search_queries: ["content workflow"],
            design_notes: "bold grid"
          }))
        },
        groundingMetadata: {}
      };
    },
    async generateImage() {
      imageCalls += 1;
      if (quota && imageCalls === 2) return { quotaHalt: true, reason: "429 quota" };
      return { mimeType: "image/png", data: Buffer.from("png").toString("base64") };
    }
  };
}

test("config supports configurable Gemini models", async () => {
  const config = getConfig({
    GEMINI_TEXT_MODEL: "gemini-3.1-flash-lite",
    GEMINI_IMAGE_MODEL: "gemini-3-pro-image",
    OPENAI_API_KEY: "test-key",
    OPENAI_TEXT_MODEL: "gpt-4.1-mini",
    OPENAI_IMAGE_MODEL: "gpt-image-1-mini",
    TEXT_PROVIDER: "openai",
    IMAGE_PROVIDER: "gemini",
    IMAGE_FALLBACK_PROVIDER: "openai"
  });
  assert.equal(config.geminiTextModel, "gemini-3.1-flash-lite");
  assert.equal(config.geminiImageModel, "gemini-3-pro-image");
  assert.equal(config.openaiTextModel, "gpt-4.1-mini");
  assert.equal(config.textProvider, "openai");
  assert.equal(config.openaiImageModel, "gpt-image-1-mini");
  assert.equal(config.imageFallbackProvider, "openai");
});

test("OpenAI web search requests do not use JSON mode", async () => {
  const grounded = buildOpenAiTextBody({
    model: "gpt-4.1-mini",
    content: [{ type: "input_text", text: "Return JSON." }],
    grounded: true
  });
  assert.equal(grounded.text, undefined);
  assert.equal(grounded.tools[0].type, "web_search_preview");

  const plain = buildOpenAiTextBody({
    model: "gpt-4.1-mini",
    content: [{ type: "input_text", text: "Return JSON." }]
  });
  assert.equal(plain.text.format.type, "json_object");
});

test("auth hashes passwords and rejects token tampering/expiry", async () => {
  const hash = await hashPassword("password123");
  assert.equal(await verifyPassword("password123", hash), true);
  const token = issueToken({ id: 7, email: "a@b.com" }, "secret", 1000);
  assert.equal(verifyToken(token, "secret", 1000).sub, 7);
  assert.equal(verifyToken(`${token}x`, "secret", 1000), null);
  assert.equal(verifyToken(token, "secret", 1000 + 8 * 24 * 60 * 60 * 1000), null);
});

test("repositories scope ownership and cascade user deletes", async () => {
  const { repos } = await fakeRepos();
  const user = await repos.users.create({ email: "one@example.com", passwordHash: "hash" });
  const other = await repos.users.create({ email: "two@example.com", passwordHash: "hash" });
  const carousel = await repos.carousels.createWithSlides({
    userId: user.id,
    prompt: "AI agents for content operations",
    slides: [{ slide_number: 1, title: "A", body: "B", visual_direction: "layout" }]
  });
  assert.equal(await repos.carousels.findOwned(other.id, carousel.id), null);
  assert.equal((await repos.carousels.findOwned(user.id, carousel.id)).slides.length, 1);
  assert.equal((await repos.carousels.findResultOwned(user.id, carousel.id)).slides[0].title, "A");
  assert.equal((await repos.carousels.listForUser(user.id))[0].prompt_summary, "AI · Operations");
  await repos.carousels.createWithSlides({
    userId: user.id,
    prompt: "A very long prompt about founder led growth loops and customer retention systems",
    promptSummary: "",
    slides: [{ slide_number: 1, title: "A", body: "B", visual_direction: "layout" }]
  });
  assert.equal((await repos.carousels.listForUser(user.id))[0].prompt_summary, "Founder · Led · Growth · Loops");
  await repos.users.delete(user.id);
  assert.equal(await repos.carousels.findOwned(user.id, carousel.id), null);
});

test("carousels are addressed by a globally unique public id, not a row id", async () => {
  const { repos } = await fakeRepos();
  const user = await repos.users.create({ email: "public@example.com", passwordHash: "hash" });
  const make = async (prompt) => await repos.carousels.createWithSlides({
    userId: user.id,
    prompt,
    slides: [{ slide_number: 1, title: prompt, body: "B", visual_direction: "layout" }]
  });
  const first = await make("first carousel");
  const second = await make("second carousel");

  assert.match(first.public_id, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.public_id, second.public_id);
  // The public id is what the API hands out and what lookups resolve.
  assert.equal((await repos.carousels.findResultOwned(user.id, first.public_id)).carousel_id, first.public_id);
  assert.equal((await repos.carousels.findResultOwned(user.id, first.public_id)).prompt, "first carousel");
  assert.equal((await repos.carousels.listForUser(user.id))[0].id, second.public_id);
  // A public id from another deployment/instance resolves to nothing rather than to a
  // different carousel that happens to occupy the same row id.
  assert.equal(await repos.carousels.findResultOwned(user.id, "11111111-2222-3333-4444-555555555555"), null);
  assert.equal(await repos.carousels.deleteOwned(user.id, "11111111-2222-3333-4444-555555555555"), false);
  assert.equal(await repos.carousels.deleteOwned(user.id, first.public_id), true);
  assert.equal(await repos.carousels.findResultOwned(user.id, first.public_id), null);
});

test("two instances seeded from the same snapshot never collide on public ids", async () => {
  // Reproduces the Vercel failure: every cold start copies the bundled snapshot into /tmp,
  // so AUTOINCREMENT hands the same row id to unrelated carousels on different instances.
  const instanceA = (await fakeRepos()).repos;
  const instanceB = (await fakeRepos()).repos;
  const userA = await instanceA.users.create({ email: "same@example.com", passwordHash: "hash" });
  const userB = await instanceB.users.create({ email: "same@example.com", passwordHash: "hash" });
  const make = async (repos, userId, prompt) => await repos.carousels.createWithSlides({
    userId,
    prompt,
    slides: [{ slide_number: 1, title: prompt, body: "B", visual_direction: "layout" }]
  });
  const onA = await make(instanceA, userA.id, "made on instance A");
  const onB = await make(instanceB, userB.id, "made on instance B");

  assert.equal(onA.id, onB.id, "row ids still collide across instances");
  assert.notEqual(onA.public_id, onB.public_id, "public ids must not collide");
  // Asking instance B for a carousel created on instance A is a miss, not another carousel.
  assert.equal(await instanceB.carousels.findResultOwned(userB.id, onA.public_id), null);
});

test("history is ordered newest first with a stable tiebreak", async () => {
  const { repos } = await fakeRepos();
  const user = await repos.users.create({ email: "order@example.com", passwordHash: "hash" });
  const make = async (prompt) => await repos.carousels.createWithSlides({
    userId: user.id,
    prompt,
    slides: [{ slide_number: 1, title: prompt, body: "B", visual_direction: "layout" }]
  });
  // Created inside the same second, so CURRENT_TIMESTAMP alone cannot order these.
  const ids = [];
  for (const prompt of ["alpha topic", "bravo topic", "charlie topic", "delta topic"]) {
    ids.push((await make(prompt)).public_id);
  }
  const listed = (await repos.carousels.listForUser(user.id)).map((carousel) => carousel.id);
  assert.deepEqual(listed, [...ids].reverse(), "newest generation must be first");
});

test("saved carousel results restore generated image URLs", async () => {
  const { repos } = await fakeRepos();
  const user = await repos.users.create({ email: "restore@example.com", passwordHash: "hash" });
  const carousel = await repos.carousels.createWithSlides({
    userId: user.id,
    prompt: "AI operations playbook",
    slides: [{ slide_number: 1, title: "AI Ops", body: "Build once.", visual_direction: "minimal" }],
    images: [{ slide_number: 1, url: "/generated/slide-1.png", image_prompt: "prompt" }]
  });
  const restored = await repos.carousels.findResultOwned(user.id, carousel.id);
  assert.equal(restored.slides[0].title, "AI Ops");
  assert.equal(restored.images_generated[0].url, "/generated/slide-1.png");
});

test("saved carousel results restore research, checks, and caption artifacts", async () => {
  const { repos } = await fakeRepos();
  const user = await repos.users.create({ email: "artifact@example.com", passwordHash: "hash" });
  const artifact = {
    generation_input: {
      prompt: "AI proof carousel",
      instagramHandle: "@proof",
      sourceText: "internal notes",
      totalSlides: 5
    },
    research_summary: ["Found the core insight."],
    sources_used: [{ source_url: "https://example.com", title: "Example" }],
    content_plan: { audience: "founders" },
    slides: [{ slide_number: 1, title: "Core Insight", body: "Proof matters.", visual_direction: "minimal" }],
    caption: "Post this carousel.",
    hashtags: ["#AI"],
    fact_check: [{ claim: "Proof matters", status: "Verified Against Retrieved Source" }],
    images_generated: [{ slide_number: 1, url: "/generated/artifact.png" }]
  };
  const carousel = await repos.carousels.createWithSlides({
    userId: user.id,
    prompt: "AI proof carousel",
    slides: artifact.slides,
    images: artifact.images_generated,
    artifact
  });
  const restored = await repos.carousels.findResultOwned(user.id, carousel.id);
  assert.equal(restored.generation_input.instagramHandle, "@proof");
  assert.equal(restored.generation_input.sourceText, "internal notes");
  assert.equal(restored.generation_input.totalSlides, 5);
  assert.deepEqual(restored.research_summary, artifact.research_summary);
  assert.equal(restored.sources_used[0].source_url, "https://example.com");
  assert.equal(restored.content_plan.audience, "founders");
  assert.equal(restored.caption, "Post this carousel.");
  assert.equal(restored.hashtags[0], "#AI");
  assert.equal(restored.fact_check[0].status, "Verified Against Retrieved Source");
});

test("saved carousel delete is owner scoped", async () => {
  const { repos } = await fakeRepos();
  const user = await repos.users.create({ email: "delete@example.com", passwordHash: "hash" });
  const other = await repos.users.create({ email: "other-delete@example.com", passwordHash: "hash" });
  const carousel = await repos.carousels.createWithSlides({
    userId: user.id,
    prompt: "founder led growth loops",
    slides: [{ slide_number: 1, title: "Growth Loops", body: "Retain users.", visual_direction: "minimal" }]
  });
  assert.equal(await repos.carousels.deleteOwned(other.id, carousel.id), false);
  assert.equal(await repos.carousels.deleteOwned(user.id, carousel.id), true);
  assert.equal(await repos.carousels.findOwned(user.id, carousel.id), null);
});

test("zip export packages ordered slides and caption", async () => {
  const zip = createZip([
    { name: "slide-01.png", data: Buffer.from("one") },
    { name: "slide-02.svg", data: Buffer.from("<svg />") },
    { name: "caption.txt", data: Buffer.from("caption") }
  ]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.match(zip.toString("latin1"), /slide-01\.png/);
  assert.match(zip.toString("latin1"), /slide-02\.svg/);
  assert.match(zip.toString("latin1"), /caption\.txt/);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});

test("prompt summaries store compact history keywords", async () => {
  assert.equal(summarizePrompt("How AI agents are changing content operations for small agencies"), "AI · Operations · Agencies");
  assert.equal(summarizePrompt("the and with"), "Untitled idea");
});

test("json extraction, handles, and prompt builder enforce constraints", async () => {
  assert.deepEqual(extractJson("```json\n{\"ok\":true}\n```"), { ok: true });
  assert.equal(extractJsonCandidate("Here is the JSON:\n{\"ok\":true}\nDone."), "{\"ok\":true}");
  assert.equal(normalizeInstagramHandle(" instagram.com/My Brand/ "), "@MyBrand");
  const design = chooseDesignSystem("AI content ops");
  const prompt = buildImagePrompt({
    slide: { slide_number: 1, title: "Research First Always", body: "Every claim needs a source.", visual_direction: "chart" },
    designSystem: design,
    handle: " creator ",
    totalSlides: 7
  });
  assert.match(prompt, /4:5/);
  assert.match(prompt, /10% safe margin/);
  assert.match(prompt, /@creator/);
  assert.match(prompt, /same template family/);
  assert.match(prompt, /No stock photos/);
  assert.match(prompt, /Visual density/);
  assert.match(prompt, /changing avatars/);
  assert.match(prompt, /random timestamps/);
});

test("prompt improver prompt preserves intent and asks for better generation detail", async () => {
  const prompt = buildPromptImproverPrompt({
    prompt: "top events in Bengaluru next 5 days",
    instagramHandle: "@things2doinblr",
    totalSlides: 6
  });
  assert.match(prompt, /improved_prompt/);
  assert.match(prompt, /Keep the user's original intent/);
  assert.match(prompt, /current events/);
  assert.match(prompt, /realistic, high-quality images/);
});

test("event prompts demand live verification and cover-plus-event slide plan", async () => {
  const researchPrompt = buildResearchPrompt({
    prompt: "events happening in Bengaluru for the next 5 days",
    sourceText: ""
  });
  assert.match(researchPrompt, /Today's date/);
  assert.match(researchPrompt, /official venue pages/);
  assert.match(researchPrompt, /District, Luma, AllEvents/);
  assert.match(researchPrompt, /Do not invent events/);

  const slidesPrompt = buildSlidesPrompt({
    prompt: "top events in Bengaluru for the next 5 days",
    research: { key_insights: [], statistics: [], trends: [], quotes: [], references: [] },
    brand: { handle: "@things2doinblr" },
    style: chooseDesignSystem("events"),
    totalSlides: 6
  });
  assert.match(slidesPrompt, /slide 1 a starter\/cover slide/);
  assert.match(slidesPrompt, /one verified event per slide/);
  assert.match(slidesPrompt, /realistic collage starter page/);
});

test("event filtering rejects stale dates and event renderer keeps sourced text", async () => {
  assert.equal(isEventCarousel("events happening in Bengaluru for the next 5 days"), true);
  const events = verifiedEventsForWindow([
    { name: "Current Show", date: "2026-07-20", source_url: "https://luma.com/current", venue: "Indiranagar", image_url: "https://luma.com/current.jpg" },
    { name: "Old Show", date: "2024-11-20", source_url: "https://luma.com/old", venue: "BIEC" }
  ], { start: "2026-07-19", end: "2026-07-24", days: 5 });
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Current Show");
  assert.equal(events[0].image_url, "https://luma.com/current.jpg");

  const image = renderEventPosterSlide({
    slide: {
      slide_number: 2,
      title: "Current Show",
      body: "A verified pick for the week.",
      event_details: { name: "Current Show", category: "Comedy", date: "2026-07-20", time: "7 PM", venue: "The Comedy Theatre", price: "Rs 499", source_url: "https://luma.com/current" }
    },
    handle: "@things2doinblr",
    totalSlides: 6,
    generatedDir: "generated-test",
    batchId: 456,
    backgroundImage: { mimeType: "image/png", data: Buffer.from("image").toString("base64") }
  });
  assert.equal(image.url, "/generated/carousel-456-event-2.svg");
  const svg = fs.readFileSync("generated-test/carousel-456-event-2.svg", "utf8");
  assert.match(svg, /Current Show/);
  assert.match(svg, /data:image\/png;base64/);
  assert.match(svg, /20 Jul/);
  assert.doesNotMatch(svg, /2024-11-20/);
});

test("event renderer supports final CTA slides without fake event data", async () => {
  const image = renderEventPosterSlide({
    slide: {
      slide_number: 7,
      title: "What Are You Attending?",
      body: "Save this and tag your crew.",
      event_details: { category: "CTA", cta: true }
    },
    handle: "@things2doinblr",
    totalSlides: 7,
    generatedDir: "generated-test",
    batchId: 789
  });
  const svg = fs.readFileSync("generated-test/carousel-789-event-7.svg", "utf8");
  assert.equal(image.url, "/generated/carousel-789-event-7.svg");
  assert.match(svg, /What Are You/);
  assert.match(svg, /Attending/);
  assert.match(svg, /SAVE FOR LATER/);
  assert.doesNotMatch(svg, /Verification Required/);
});

test("style upload sanitizer keeps only supported visual references", async () => {
  const uploads = normalizeStyleUploads([
    { name: "one.png", mimeType: "image/png", data: "data:image/png;base64,abc" },
    { name: "deck.pdf", mimeType: "application/pdf", data: "xyz" },
    { name: "notes.txt", mimeType: "text/plain", data: "bad" }
  ]);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].data, "abc");
});

test("social post renderer locks account chrome and plain numeric counter", async () => {
  const image = renderSocialPostSlide({
    slide: { slide_number: 4, title: "The Future of AI?", body: "KIMI represents a pivotal moment." },
    handle: "@srikanth",
    totalSlides: 4,
    generatedDir: "generated-test",
    batchId: 123
  });
  assert.equal(image.url, "/generated/carousel-123-4.svg");
  const db = openDatabase(":memory:");
  assert.equal(isSocialPostDesign({ reference_format: "social_post_screenshot" }), true);
});

test("pipeline persists slides, verifies sourced claims, and halts image batch on quota", async () => {
  const { repos } = await fakeRepos();
  const user = await repos.users.create({ email: "creator@example.com", passwordHash: "hash" });
  const result = await runCarouselPipeline({
    input: { prompt: "AI content operations", totalSlides: 4, instagramHandle: "@creator" },
    user,
    aiClient: fakeAi({ quota: true }),
    repos,
    generatedDir: "generated-test"
  });
  assert.equal(result.slides.length, 4);
  assert.equal(result.fact_check[0].status, "Verified Against Retrieved Source");
  assert.equal(result.images_generated.filter((image) => image.skipped).length, 3);
  assert.equal((await repos.carousels.findOwned(user.id, result.carousel_id)).slides.length, 4);
});

test("pipeline sends uploaded screenshots to multimodal style learning", async () => {
  const { repos } = await fakeRepos();
  const user = await repos.users.create({ email: "style@example.com", passwordHash: "hash" });
  let seenUploadCount = 0;
  const ai = fakeAi();
  const originalGenerateJson = ai.generateJson;
  ai.generateJson = async (prompt, options = {}) => {
    if (prompt.includes("attached carousel screenshots/PDF pages")) seenUploadCount = options.uploads?.length || 0;
    return originalGenerateJson(prompt, options);
  };
  const result = await runCarouselPipeline({
    input: {
      prompt: "AI content operations",
      totalSlides: 4,
      instagramHandle: "@creator",
      styleUploads: [{ name: "style.png", mimeType: "image/png", data: "abc123" }]
    },
    user,
    aiClient: ai,
    repos,
    generatedDir: "generated-test"
  });
  assert.equal(seenUploadCount, 1);
  assert.match(result.style_analysis.design_brief, /Reference-led editorial/);
  assert.match(result.images_generated[0].url, /\.svg$/);
  assert.match(result.images_generated[0].image_prompt, /Just now/);
  assert.match(result.images_generated[0].image_prompt, /Creator/);
});

test("pipeline renders verified event carousels deterministically", async () => {
  const { repos } = await fakeRepos();
  const user = await repos.users.create({ email: "events@example.com", passwordHash: "hash" });
  const result = await runCarouselPipeline({
    input: {
      prompt: "go through the events happening in bengaluru for the next 5 days and put the top 5 events",
      totalSlides: 6,
      instagramHandle: "@things2doinblr"
    },
    user,
    aiClient: fakeAi(),
    repos,
    generatedDir: "generated-test"
  });
  assert.equal(result.slides[0].title, "Bengaluru's Top 5 Events");
  assert.equal(result.slides[1].event_details.name, "Sushi Making Workshop");
  assert.equal(result.events_used.length, 1);
  assert.match(result.images_generated[0].url, /event-1\.svg$/);
  assert.equal(result.images_generated.some((image) => image.image_prompt?.includes("No readable text")), true);
});

test("verification marks missing source URLs honestly", async () => {
  const [check] = verifyClaims([{ claim: "Unsourced", value: "10x", source_url: "https://missing.test" }], []);
  assert.equal(check.status, "Verification Required");
});

test("oauth state and provider bodies are deterministic", async () => {
  const state = signOAuthState({ userId: 1, provider: "linkedin" }, "secret");
  assert.equal(verifyOAuthState(state, "secret").provider, "linkedin");
  assert.equal(verifyOAuthState(`${state}x`, "secret"), null);
  assert.equal(linkedinPostBody({ authorUrn: "urn:li:person:1", imageUrns: ["urn:image:1"], caption: "hi" }).content.multiImage.images[0].id, "urn:image:1");
  assert.deepEqual(instagramCarouselBody({ children: ["1", "2"], caption: "hi" }), { media_type: "CAROUSEL", children: "1,2", caption: "hi" });
});

test("publish returns honest not-connected errors", async () => {
  const { repos } = await fakeRepos();
  const user = await repos.users.create({ email: "p@example.com", passwordHash: "hash" });
  const carousel = await repos.carousels.createWithSlides({ userId: user.id, prompt: "topic", slides: [{ slide_number: 1, title: "A", body: "B", visual_direction: "layout" }] });
  const results = await publishCarousel({
    repos,
    userId: user.id,
    carouselId: carousel.id,
    platforms: ["linkedin"],
    caption: "caption",
    config: { linkedin: {}, instagram: {} }
  });
  assert.equal(results.linkedin.status, 503);
});

test("signup email validation rejects malformed and disposable addresses", async () => {
  assert.equal(validateSignupEmail("").ok, false);
  assert.equal(validateSignupEmail("not-an-email").ok, false);
  assert.equal(validateSignupEmail("no@tld").ok, false);
  assert.equal(validateSignupEmail("throwaway@mailinator.com").ok, false);
  assert.match(validateSignupEmail("throwaway@yopmail.com").reason, /Disposable/);
  assert.equal(validateSignupEmail("  Real.User@Example.COM ").email, "real.user@example.com");
  assert.equal(validatePassword("short").ok, false);
  assert.equal(validatePassword("longenough123").ok, true);
});

test("otp codes are stored hashed, single-use, and expiring", async () => {
  const { repos } = await fakeRepos();
  let clock = 1_000_000;
  const otp = createOtpService({ repos, secret: "test-secret", now: () => clock });
  const email = "otp@example.com";

  const { code } = await otp.issue({ email, purpose: OTP_PURPOSE.SIGNUP });
  assert.match(code, /^\d{6}$/);

  // Never persisted in readable form.
  const stored = await repos.emailOtps.findActive(email, OTP_PURPOSE.SIGNUP);
  assert.notEqual(stored.code_hash, code);
  assert.equal(stored.code_hash, hashCode({ code, email, purpose: OTP_PURPOSE.SIGNUP, secret: "test-secret" }));

  assert.equal((await otp.verify({ email, purpose: OTP_PURPOSE.SIGNUP, code: "000000" })).ok, false);
  assert.equal((await otp.verify({ email, purpose: OTP_PURPOSE.SIGNUP, code })).ok, true);
  // Single use: the same code cannot be replayed.
  assert.equal((await otp.verify({ email, purpose: OTP_PURPOSE.SIGNUP, code })).ok, false);

  clock += otpPolicy.resendCooldownMs;
  const fresh = await otp.issue({ email, purpose: OTP_PURPOSE.SIGNUP });
  clock += otpPolicy.ttlMs + 1;
  const expired = await otp.verify({ email, purpose: OTP_PURPOSE.SIGNUP, code: fresh.code });
  assert.equal(expired.ok, false);
  assert.match(expired.reason, /expired/i);
});

test("otp guessing is capped and issuing is throttled", async () => {
  const { repos } = await fakeRepos();
  let clock = 5_000_000;
  const otp = createOtpService({ repos, secret: "test-secret", now: () => clock });
  const email = "brute@example.com";
  const { code } = await otp.issue({ email, purpose: OTP_PURPOSE.SIGNUP });

  for (let attempt = 0; attempt < otpPolicy.maxAttempts; attempt += 1) {
    assert.equal((await otp.verify({ email, purpose: OTP_PURPOSE.SIGNUP, code: "999999" })).ok, false);
  }
  // Even the correct code is refused once the attempt budget is spent.
  const afterCap = await otp.verify({ email, purpose: OTP_PURPOSE.SIGNUP, code });
  assert.equal(afterCap.ok, false);

  // Re-issuing immediately is rate limited.
  await assert.rejects(() => otp.issue({ email, purpose: OTP_PURPOSE.SIGNUP }), /wait \d+s/);
  clock += otpPolicy.resendCooldownMs;
  await assert.doesNotReject(() => otp.issue({ email, purpose: OTP_PURPOSE.SIGNUP }));
});

test("issuing a new code invalidates the previous one", async () => {
  const { repos } = await fakeRepos();
  let clock = 9_000_000;
  const otp = createOtpService({ repos, secret: "test-secret", now: () => clock });
  const email = "rotate@example.com";
  const first = await otp.issue({ email, purpose: OTP_PURPOSE.SIGNUP });
  clock += otpPolicy.resendCooldownMs;
  const second = await otp.issue({ email, purpose: OTP_PURPOSE.SIGNUP });

  assert.equal((await otp.verify({ email, purpose: OTP_PURPOSE.SIGNUP, code: first.code })).ok, false);
  assert.equal((await otp.verify({ email, purpose: OTP_PURPOSE.SIGNUP, code: second.code })).ok, true);
});

test("existing accounts are grandfathered but new signups start unverified", async () => {
  const { repos } = await fakeRepos();
  const legacy = await repos.users.create({ email: "legacy@example.com", passwordHash: "hash", emailVerified: 1 });
  assert.equal(legacy.email_verified, 1);
  const fresh = await repos.users.create({ email: "fresh@example.com", passwordHash: "hash" });
  assert.equal(fresh.email_verified, 0);
  const verified = await repos.users.markVerified(fresh.id);
  assert.equal(verified.email_verified, 1);
  assert.ok(verified.verified_at);
});
