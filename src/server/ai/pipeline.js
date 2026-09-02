import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { buildImagePrompt, buildResearchPrompt, buildSlidesPrompt, buildTemplateTextPrompt, chooseDesignSystem } from "./prompts.js";
import { ensureArray } from "../utils/json.js";
import { normalizeInstagramHandle } from "../utils/handle.js";
import { summarizePrompt } from "../utils/summary.js";
import { isSocialPostDesign, renderSocialPostSlide } from "../renderers/socialPostRenderer.js";
import { renderEventPosterSlide } from "../renderers/eventPosterRenderer.js";

function sourceRefs(groundingMetadata) {
  return ensureArray(groundingMetadata?.groundingChunks)
    .map((chunk) => chunk.web)
    .filter(Boolean)
    .map((web) => ({
      source_url: web.uri,
      title: web.title || web.uri,
      extracted_content: "Retrieved through Google Search grounding.",
      credibility_score: 0.7
    }));
}

function mergeReferences(modelRefs = [], groundedRefs = []) {
  const byUrl = new Map();
  for (const ref of [...ensureArray(modelRefs), ...groundedRefs]) {
    if (ref?.source_url) byUrl.set(ref.source_url, { ...ref, extracted_content: ref.extracted_content || "Referenced source." });
  }
  return [...byUrl.values()];
}

function eventReferences(events = []) {
  return ensureArray(events)
    .filter((event) => event.source_url)
    .map((event) => ({
      source_url: event.source_url,
      title: event.name || event.source_url,
      extracted_content: [event.date, event.venue, event.price].filter(Boolean).join(" - "),
      credibility_score: event.confidence === "high" ? 0.9 : 0.75
    }));
}

const allowedStyleMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

export function normalizeStyleUploads(styleUploads = []) {
  return ensureArray(styleUploads)
    .slice(0, 8)
    .map((upload) => ({
      name: String(upload.name || "style-reference").slice(0, 120),
      mimeType: String(upload.mimeType || ""),
      data: String(upload.data || "").replace(/^data:[^;]+;base64,/, "")
    }))
    .filter((upload) => allowedStyleMimeTypes.has(upload.mimeType) && upload.data.length > 0);
}

function colorOr(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

/**
 * Keeps the avatar with the record so a slide can be rebuilt later with the right profile
 * photo. Downscaled to twice its rendered size first, so an uploaded 4 MB photo does not
 * become 4 MB of base64 inside every stored carousel.
 */
async function storableAvatar(upload) {
  if (!upload?.data) return null;
  try {
    const png = await sharp(Buffer.from(upload.data, "base64"))
      .resize(176, 176, { fit: "cover" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return { name: upload.name, mimeType: "image/png", data: png.toString("base64") };
  } catch {
    return null;
  }
}

export function normalizeTemplate(template = {}) {
  const avatarUpload = normalizeStyleUploads(template.avatarUpload ? [template.avatarUpload] : [])
    .filter((upload) => upload.mimeType.startsWith("image/"))[0] || null;
  const id = String(template.id || "").trim();
  if (!id) return null;
  return {
    id,
    name: String(template.name || "Social proof post").slice(0, 80),
    profileName: String(template.profileName || "").trim().slice(0, 42),
    timestamp: String(template.timestamp || "Just now").trim().slice(0, 24) || "Just now",
    backgroundColor: colorOr(template.backgroundColor, "#ffffff"),
    textColor: colorOr(template.textColor, "#111111"),
    mutedColor: colorOr(template.mutedColor, "#737373"),
    borderColor: colorOr(template.borderColor, "#dedbd4"),
    badgeColor: colorOr(template.badgeColor, "#2374d5"),
    avatarUpload
  };
}

export function verifyClaims(statistics = [], references = []) {
  const urls = new Set(references.map((ref) => ref.source_url));
  return statistics.map((stat) => ({
    claim: stat.claim,
    value: stat.value,
    source_url: stat.source_url || "",
    status: stat.source_url && urls.has(stat.source_url) ? "Verified Against Retrieved Source" : "Verification Required",
    confidence: stat.confidence || "unknown"
  }));
}

export function isEventCarousel(prompt = "") {
  return /\b(event|events|happening|workshop|concert|show|summit|meetup|festival|exhibit|exhibition)\b/i.test(String(prompt));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function eventWindow(prompt = "", now = new Date()) {
  const match = String(prompt).match(/next\s+(\d{1,2})\s+days?/i);
  const days = match ? Math.min(14, Math.max(1, Number(match[1]))) : 5;
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return { start: isoDate(start), end: isoDate(addDays(start, days)), days };
}

function overlapsWindow(event, window) {
  const start = String(event.date || event.date_start || "").slice(0, 10);
  const end = String(event.date_end || start).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return false;
  return start <= window.end && end >= window.start;
}

function normalizeEvent(event, window) {
  return {
    name: String(event.name || event.title || "Verified Event").trim(),
    category: String(event.category || "Event").trim(),
    date: String(event.date || event.date_start || "").slice(0, 10),
    date_start: String(event.date_start || event.date || "").slice(0, 10),
    date_end: String(event.date_end || event.date || event.date_start || "").slice(0, 10),
    time: String(event.time || "").trim(),
    venue: String(event.venue || event.location || "").trim(),
    area: String(event.area || "").trim(),
    price: String(event.price || "").trim(),
    booking_url: String(event.booking_url || event.url || "").trim(),
    source_url: String(event.source_url || event.booking_url || event.url || "").trim(),
    image_url: String(event.image_url || event.image || event.cover_image_url || "").trim(),
    why_pick: String(event.why_pick || event.description || "Verified upcoming event.").trim(),
    confidence: String(event.confidence || "unknown").trim(),
    window
  };
}

export function verifiedEventsForWindow(events = [], window = eventWindow()) {
  return ensureArray(events)
    .map((event) => normalizeEvent(event, window))
    .filter((event) => event.name && event.source_url && overlapsWindow(event, window))
    .slice(0, 8);
}

function researchArtifact(researchResponse, events = []) {
  const groundedRefs = sourceRefs(researchResponse.groundingMetadata);
  return {
    key_insights: ensureArray(researchResponse.json.key_insights),
    statistics: ensureArray(researchResponse.json.statistics),
    events,
    trends: ensureArray(researchResponse.json.trends),
    quotes: ensureArray(researchResponse.json.quotes),
    references: mergeReferences([...ensureArray(researchResponse.json.references), ...eventReferences(events)], groundedRefs)
  };
}

function requestedTopCount(prompt = "", fallback = 5) {
  const match = String(prompt).match(/\btop\s+(\d{1,2})\b/i);
  return match ? Math.min(8, Math.max(1, Number(match[1]))) : fallback;
}

function selectDiverseEvents(events, count) {
  const selected = [];
  const usedCategories = new Set();
  for (const event of events) {
    const category = event.category.toLowerCase();
    if (selected.length < count && !usedCategories.has(category)) {
      selected.push(event);
      usedCategories.add(category);
    }
  }
  for (const event of events) {
    if (selected.length >= count) break;
    if (!selected.includes(event)) selected.push(event);
  }
  return selected;
}

function ctaSlide({ slideNumber, totalSlides, handle, window }) {
  return {
    slide_number: slideNumber,
    title: "What Are You Attending?",
    body: "Save this, tag your crew, and make plans now.",
    visual_direction: "dark Bengaluru city CTA poster",
    image_search_queries: ["Bengaluru night skyline events"],
    design_notes: "Final CTA slide matching the event poster system.",
    event_details: {
      name: "What Are You Attending?",
      category: "CTA",
      date: `${window.start} to ${window.end}`,
      time: "",
      venue: "Bengaluru",
      area: "",
      price: "Save for later",
      source_url: "",
      why_pick: `Follow ${handle || "@things2doinblr"} for more Bengaluru updates.`,
      confidence: "n/a",
      cta: true
    }
  };
}

function buildEventSlides({ events, totalSlides, handle, window, topCount = 5 }) {
  const slots = Math.max(0, totalSlides - 1);
  const shouldAddCta = slots > topCount;
  const eventSlots = shouldAddCta ? slots - 1 : slots;
  const selected = selectDiverseEvents(events, Math.min(topCount, eventSlots));
  const cover = {
    slide_number: 1,
    title: `Bengaluru's Top ${Math.min(topCount, Math.max(selected.length, topCount))} Events`,
    body: `Verified picks from ${window.start} to ${window.end} across food, comedy, culture, tech, and more.`,
    visual_direction: "realistic event collage cover",
    image_search_queries: selected.map((event) => `${event.name} Bengaluru event`),
    design_notes: "Cover slide with collage-style event energy and locked text zones.",
    event_details: { date: `${window.start} to ${window.end}`, handle }
  };
  const eventSlides = selected.map((event, index) => ({
    slide_number: index + 2,
    title: event.name.split(/\s+/).slice(0, 6).join(" "),
    body: event.why_pick.split(/\s+/).slice(0, 18).join(" "),
    visual_direction: `${event.category} event poster`,
    image_search_queries: [`${event.name} ${event.venue} Bengaluru`],
    design_notes: "Use verified event metadata only. Text is rendered deterministically.",
    event_details: event
  }));
  for (let index = selected.length; index < eventSlots; index += 1) {
    eventSlides.push({
      slide_number: index + 2,
      title: "Verification Required",
      body: "No current trusted listing was verified for this slot.",
      visual_direction: "verification required event poster",
      image_search_queries: [],
      design_notes: "Do not invent event details.",
      event_details: {
        name: "Verification Required",
        category: "Event",
        date: `${window.start} to ${window.end}`,
        time: "",
        venue: "Check trusted listings",
        area: "Bengaluru",
        price: "Verification Required",
        source_url: "",
        why_pick: "No current trusted source was verified for this slot.",
        confidence: "none"
      }
    });
  }
  if (shouldAddCta) eventSlides.push(ctaSlide({ slideNumber: totalSlides, totalSlides, handle, window }));
  return [cover, ...eventSlides];
}

async function fetchEventImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "image/avif,image/webp,image/png,image/jpeg,*/*" } });
    clearTimeout(timeout);
    const type = response.headers.get("content-type") || "";
    const length = Number(response.headers.get("content-length") || 0);
    if (!response.ok || !type.startsWith("image/") || length > 8 * 1024 * 1024) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 8 * 1024 * 1024) return null;
    return { mimeType: type.split(";")[0], data: buffer.toString("base64") };
  } catch {
    return null;
  }
}

function buildEventBackgroundPrompt(slide, totalSlides) {
  const event = slide.event_details || {};
  if (slide.slide_number === 1) {
    return `Create a realistic dark premium Instagram carousel cover background for Bengaluru events this week.
Portrait 4:5 poster composition, cinematic editorial collage energy, no readable text, no logos, no numbers, no watermarks.
Include visual hints across varied categories: stand-up comedy stage, sushi workshop food closeup, live music stage, startup meetup, pottery/experience workshop.
Mood: high-end local city guide like a premium Bengaluru events Instagram page, black background, warm highlights, realistic photography, clean darker lower half for typography overlay.
Do not generate typography, posters, flyers, fake UI, QR codes, dates, prices, venue names, or captions.`;
  }
  return `Create a realistic dark premium event poster background for this Bengaluru event.
Event category: ${event.category || slide.visual_direction}. Event name context: ${event.name || slide.title}. Venue context: ${event.venue || "Bengaluru"}.
Portrait 4:5, cinematic realistic photography, premium local-events Instagram style similar to high-end comedy/food/workshop event creatives, rich contrast, shallow depth of field, black/warm color grade.
Create one strong hero visual in the upper 60% of the frame. Leave the lower 40% darker, uncluttered, and clean for typography overlay.
No readable text, no logos, no dates, no prices, no watermarks, no fake posters, no UI, no overlaid graphics.
This is slide ${slide.slide_number}/${totalSlides}.`;
}

export async function runCarouselPipeline({ input, user, aiClient, repos, generatedDir = path.resolve("generated") }) {
  if (!aiClient?.configured) {
    const error = new Error("GEMINI_API_KEY is not configured. Add it to .env to run real research and generation.");
    error.status = 503;
    throw error;
  }

  const totalSlides = Math.min(12, Math.max(4, Number(input.totalSlides || 7)));
  const handle = normalizeInstagramHandle(input.instagramHandle || "");
  const styleUploads = normalizeStyleUploads(input.styleUploads);
  const profilePhotoUpload = normalizeStyleUploads(input.profilePhotoUpload ? [input.profilePhotoUpload] : [])
    .filter((upload) => upload.mimeType.startsWith("image/"))[0] || null;
  const template = normalizeTemplate(input.template);
  const templateMode = Boolean(template);
  const eventMode = isEventCarousel(input.prompt);
  const currentEventWindow = eventWindow(input.prompt);
  const researchResponse = await aiClient.generateJson(buildResearchPrompt(input), { grounded: true });
  const events = verifiedEventsForWindow(researchResponse.json.events, currentEventWindow);
  const research = researchArtifact(researchResponse, events);

  const styleAnalysis = templateMode
    ? {
        json: {
          reference_format: "social_post_screenshot",
          design_brief: "A locked social text-post carousel template with consistent profile chrome, large readable text, and no changing imagery between slides.",
          color_palette: [template.backgroundColor, template.textColor, template.mutedColor, template.badgeColor],
          image_policy: "Use only the fixed profile avatar supplied by the user. Do not generate body photos.",
          consistency_rules: [
            "Keep the same profile name, avatar, timestamp, verification badge, menu dots, colors, and slide counter on every slide.",
            "Only slide title and body text may change.",
            "Do not copy identity details from reference screenshots unless typed by the user."
          ]
        }
      }
    : styleUploads.length
    ? await aiClient.generateJson(
        `Analyze the attached carousel screenshots/PDF pages as visual style references for a new carousel.
Return strict JSON with:
{
  "design_brief": "2-4 sentences describing the exact reusable carousel design system",
  "color_palette": ["hex colors only"],
  "font_styles": ["headline font description", "body font description"],
  "alignment": "specific grid/alignment rule",
  "layout_rules": ["repeatable rule 1", "repeatable rule 2", "repeatable rule 3"],
  "visual_density": "low/medium/high plus short explanation",
  "image_policy": "when and how to use images, icons, diagrams, or shapes",
  "consistency_rules": ["rules that keep every generated slide visually matching"],
  "reference_format": "one of: minimal_editorial, social_post_screenshot, tweet_like_text_post, facebook_like_text_post, quote_card, mixed",
  "fixed_chrome": {
    "account_identity_policy": "how account name/handle should appear consistently; never copy a reference person's identity unless typed by the user",
    "avatar_policy": "whether an avatar exists, whether it is neutral, and that it must be present or absent consistently on every slide",
    "timestamp_policy": "exact timestamp/chrome rule; if present keep the same value every slide, never randomize",
    "menu_policy": "whether top-right menu dots exist and must stay fixed",
    "badge_policy": "whether a verification/check badge exists and must stay fixed"
  },
  "writing_style": { "voice": "...", "rhythm": "...", "caption_density": "..." }
}
Focus on transferable design patterns: typography hierarchy, margins, layout grid, palette, image treatment, icon/shape usage, caption density, page numbering, footer style, background treatment, and recurring motifs.
The generated carousel must look like the same designer made it from the uploaded reference. Do not merely describe a broad vibe.
If the upload is a social-media post screenshot like Facebook/Twitter/LinkedIn text post, classify it as social_post_screenshot or tweet_like_text_post. Identify the profile row/header as fixed chrome, not content. The main content area should be text-only unless the reference clearly contains repeated image panels.
For text-post screenshots, explicitly set image_policy to "no photos in the body; only a small consistent neutral avatar if the header requires it" and set consistency_rules that prevent random profile photos, changing names, changing timestamps, missing avatars, extra avatars, or inconsistent menu dots.
Do not copy logos, private marks, personal likenesses, or exact source text. Do not describe the uploaded files as unavailable.`,
        { uploads: styleUploads }
      )
    : { json: chooseDesignSystem(input.prompt) };
  const style = chooseDesignSystem(input.prompt, styleAnalysis.json);

  const brandAnalysis = input.instagramHandle
    ? (
        await aiClient.generateJson(
          `Research public Instagram/web presence for ${handle}. Return JSON brand profile. State that private or logged-in data is not accessible.`,
          { grounded: true }
        )
      ).json
    : { handle, note: "No Instagram handle supplied; private/logged-in data is not accessible." };

  const planResponse = await aiClient.generateJson(
    buildSlidesPrompt({ prompt: input.prompt, research, brand: brandAnalysis, style, totalSlides, template })
  );
  const plannedSlides = ensureArray(planResponse.json.slides).slice(0, totalSlides).map((slide, index) => ({
    slide_number: index + 1,
    title: String(slide.title || `Key Idea ${index + 1}`).split(/\s+/).slice(0, templateMode ? 8 : 6).join(" "),
    body: String(slide.body || "Verification Required."),
    visual_direction: templateMode ? "locked social text post template" : slide.visual_direction || "editorial diagram",
    image_search_queries: templateMode ? [] : ensureArray(slide.image_search_queries),
    design_notes: slide.design_notes || "",
    event_details: slide.event_details || null
  }));
  const slides = eventMode && !templateMode
    ? buildEventSlides({ events: research.events, totalSlides, handle, window: currentEventWindow, topCount: requestedTopCount(input.prompt) })
    : plannedSlides;

  fs.mkdirSync(generatedDir, { recursive: true });
  const images = [];
  let quotaHalt = false;
  const deterministicBatchId = Date.now();
  for (const slide of slides) {
    if (eventMode && !templateMode) {
      let background = null;
      let imagePrompt = buildEventBackgroundPrompt(slide, slides.length);
      if (slide.slide_number === 1 || slide.event_details?.source_url || slide.event_details?.cta) {
        background = await fetchEventImage(slide.event_details?.image_url);
        if (!background) {
          const visual = await aiClient.generateImage(imagePrompt);
          if (visual?.data) background = visual;
          if (visual?.quotaHalt) imagePrompt = `${imagePrompt}\nImage provider skipped: ${visual.reason}`;
        } else {
          imagePrompt = `Used sourced event image: ${slide.event_details.image_url}`;
        }
      }
      images.push(renderEventPosterSlide({ slide, handle, totalSlides: slides.length, generatedDir, batchId: deterministicBatchId, backgroundImage: background, imagePrompt }));
      continue;
    }
    if (templateMode || isSocialPostDesign(style)) {
      images.push(renderSocialPostSlide({
        slide,
        handle,
        totalSlides: slides.length,
        generatedDir,
        batchId: deterministicBatchId,
        template: template || { avatarUpload: profilePhotoUpload }
      }));
      continue;
    }
    if (quotaHalt) {
      images.push({ slide_number: slide.slide_number, skipped: true, reason: "Skipped after image quota halt." });
      continue;
    }
    const prompt = buildImagePrompt({ slide, designSystem: style, handle, totalSlides: slides.length });
    const image = await aiClient.generateImage(prompt);
    if (image.quotaHalt) {
      quotaHalt = true;
      images.push({ slide_number: slide.slide_number, skipped: true, reason: image.reason, image_prompt: prompt });
      continue;
    }
    if (image.data) {
      const filename = `carousel-${Date.now()}-${slide.slide_number}.png`;
      fs.writeFileSync(path.join(generatedDir, filename), Buffer.from(image.data, "base64"));
      images.push({ slide_number: slide.slide_number, url: `/generated/${filename}`, image_prompt: prompt });
    } else {
      images.push({ slide_number: slide.slide_number, skipped: true, reason: image.reason, image_prompt: prompt });
    }
  }

  const artifact = {
    generation_input: {
      prompt: input.prompt,
      instagramHandle: input.instagramHandle || "",
      sourceText: input.sourceText || "",
      totalSlides,
      profilePhotoUpload: await storableAvatar(profilePhotoUpload),
      template: template ? { ...template, avatarUpload: await storableAvatar(template.avatarUpload) } : null
    },
    research_summary: research.key_insights,
    sources_used: research.references,
    events_used: research.events,
    style_analysis: style,
    brand_analysis: brandAnalysis,
    content_plan: planResponse.json.content_plan || {},
    slides,
    image_recommendations: slides.flatMap((slide) => slide.image_search_queries),
    caption: planResponse.json.caption || "",
    hashtags: ensureArray(planResponse.json.hashtags),
    fact_check: verifyClaims(research.statistics, research.references),
    images_generated: images
  };
  const carousel = await repos.carousels.createWithSlides({
    userId: user.id,
    prompt: input.prompt,
    promptSummary: summarizePrompt(input.prompt),
    slides,
    images,
    artifact
  });
  return {
    // Public id, so the client never holds an identifier that another instance can reuse.
    carousel_id: carousel.public_id,
    ...artifact
  };
}

export async function runTemplateCarouselPipeline({ input, user, aiClient, repos, generatedDir = path.resolve("generated") }) {
  if (!aiClient?.configured) {
    const error = new Error("GEMINI_API_KEY is not configured. Add it to .env to run real research and generation.");
    error.status = 503;
    throw error;
  }

  const totalSlides = Math.min(12, Math.max(4, Number(input.totalSlides || 6)));
  const handle = normalizeInstagramHandle(input.instagramHandle || "");
  const template = normalizeTemplate(input.template);
  if (!template) {
    const error = new Error("Select a template before generating.");
    error.status = 400;
    throw error;
  }

  const researchResponse = await aiClient.generateJson(buildResearchPrompt(input), { grounded: true });
  const research = researchArtifact(researchResponse, []);
  const textResponse = await aiClient.generateJson(buildTemplateTextPrompt({
    prompt: input.prompt,
    sourceText: input.sourceText || "",
    research,
    template,
    totalSlides
  }));

  const slides = ensureArray(textResponse.json.slides).slice(0, totalSlides).map((slide, index) => ({
    slide_number: index + 1,
    title: String(slide.title || `Key Idea ${index + 1}`).split(/\s+/).slice(0, 8).join(" "),
    body: String(slide.body || "Add one clear supporting thought.").replace(/\s+/g, " ").trim(),
    visual_direction: "locked social text post template",
    image_search_queries: [],
    design_notes: "Template Studio: only title and body text changed. Template chrome is rendered by code.",
    event_details: null
  }));
  while (slides.length < totalSlides) {
    slides.push({
      slide_number: slides.length + 1,
      title: "One Clear Takeaway",
      body: "Use this slide to make the idea easier to remember.",
      visual_direction: "locked social text post template",
      image_search_queries: [],
      design_notes: "Template Studio fallback text slot.",
      event_details: null
    });
  }

  fs.mkdirSync(generatedDir, { recursive: true });
  const batchId = Date.now();
  const images = slides.map((slide) => renderSocialPostSlide({
    slide,
    handle,
    totalSlides,
    generatedDir,
    batchId,
    template
  }));

  const style = {
    reference_format: "locked_template",
    design_brief: "Template Studio locked social-post layout. Only slide text changes.",
    color_palette: [template.backgroundColor, template.textColor, template.mutedColor, template.badgeColor],
    image_policy: "No generated images, charts, icons, diagrams, or body graphics.",
    consistency_rules: [
      "Renderer owns all layout and chrome.",
      "Same profile photo, profile name, timestamp, menu dots, badge, colors, and slide counter on every slide.",
      "Only title and body text change."
    ]
  };
  const artifact = {
    generation_input: {
      prompt: input.prompt,
      instagramHandle: input.instagramHandle || "",
      sourceText: input.sourceText || "",
      totalSlides,
      template: { ...template, avatarUpload: await storableAvatar(template.avatarUpload) }
    },
    research_summary: research.key_insights,
    sources_used: research.references,
    events_used: [],
    style_analysis: style,
    brand_analysis: { handle, template: template.name },
    content_plan: { mode: "Template Studio", rule: "AI generated text only; code rendered the fixed template." },
    slides,
    image_recommendations: [],
    caption: textResponse.json.caption || "",
    hashtags: ensureArray(textResponse.json.hashtags),
    fact_check: verifyClaims(research.statistics, research.references),
    images_generated: images
  };
  const carousel = await repos.carousels.createWithSlides({
    userId: user.id,
    prompt: input.prompt,
    promptSummary: summarizePrompt(input.prompt),
    slides,
    images,
    artifact
  });
  return {
    // Public id, so the client never holds an identifier that another instance can reuse.
    carousel_id: carousel.public_id,
    ...artifact
  };
}
