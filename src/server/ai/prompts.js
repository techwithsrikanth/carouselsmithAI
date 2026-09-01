import { normalizeInstagramHandle } from "../utils/handle.js";

const templates = [
  {
    name: "Minimal Instagram editorial",
    palette: ["#f8f5ef", "#111315", "#d94f3d", "#2f7d6d"],
    fonts: ["bold clean sans headline", "neutral sans body"],
    alignment: "left aligned on a simple 12-column grid with generous margins"
  },
  {
    name: "Quiet creator studio",
    palette: ["#fbfaf6", "#16181b", "#3d7568", "#c85a42"],
    fonts: ["compact grotesk headline", "plain readable sans body"],
    alignment: "consistent left rail, top-right page number, bottom-left handle"
  },
  {
    name: "Founder notes",
    palette: ["#f7f2e8", "#141517", "#ca4f3b", "#496f63"],
    fonts: ["large bold display sans", "small bookish sans body"],
    alignment: "asymmetric but repeatable editorial layout"
  }
];

function fallbackDesignSystem(topic = "") {
  const sum = [...topic].reduce((total, char) => total + char.charCodeAt(0), 0);
  const selected = templates[sum % templates.length];
  return {
    design_brief: `${selected.name}: minimal Instagram carousel with strong typography, restrained color, simple editorial shapes, and very little imagery.`,
    color_palette: selected.palette,
    font_styles: selected.fonts,
    alignment: selected.alignment,
    layout_rules: [
      "Use the same margin system, page number position, footer position, and typography scale on every slide.",
      "Use one dominant headline block, one short supporting line, and one small visual accent at most.",
      "Keep the background mostly clean with large areas of negative space."
    ],
    visual_density: "low to medium; typography-led, not image-led",
    image_policy: "No stock photos or decorative image collages. Use simple flat icons, tiny diagrams, thin lines, tables, or one restrained abstract shape only when it clarifies the point.",
    consistency_rules: [
      "All slides must look like one template family.",
      "Do not change art style, lighting, texture, or layout system between slides.",
      "Repeat the same footer, numbering, palette, and spacing rhythm."
    ],
    reference_format: "minimal_editorial",
    fixed_chrome: {
      account_identity_policy: "Use the user's handle as the only account identity.",
      avatar_policy: "No avatar unless the chosen template explicitly needs a small neutral mark.",
      timestamp_policy: "No timestamp in the fallback editorial template.",
      menu_policy: "No social menu chrome in the fallback editorial template."
    },
    writing_style: { voice: "plain-spoken expert", rhythm: "short hooks, concrete proof, clear payoff" }
  };
}

function completeDesignSystem(topic, style = {}) {
  const fallback = fallbackDesignSystem(topic);
  return {
    ...fallback,
    ...style,
    color_palette: style.color_palette?.length ? style.color_palette : fallback.color_palette,
    font_styles: style.font_styles?.length ? style.font_styles : fallback.font_styles,
    layout_rules: style.layout_rules?.length ? style.layout_rules : fallback.layout_rules,
    consistency_rules: style.consistency_rules?.length ? style.consistency_rules : fallback.consistency_rules,
    visual_density: style.visual_density || fallback.visual_density,
    image_policy: style.image_policy || fallback.image_policy,
    reference_format: style.reference_format || fallback.reference_format,
    fixed_chrome: style.fixed_chrome || fallback.fixed_chrome,
    writing_style: style.writing_style || fallback.writing_style
  };
}

export function chooseDesignSystem(topic = "", style = {}) {
  return completeDesignSystem(topic, style);
}

export function buildResearchPrompt({ prompt, sourceText }) {
  const today = new Date().toISOString().slice(0, 10);
  return `Research this carousel topic before writing. Today's date is ${today}. Topic: ${prompt}
Optional source text: ${sourceText || "none"}
If the topic asks for upcoming events, search for events happening within the requested date window, prioritize trusted current listings from District, Luma, AllEvents, BookMyShow, Insider, official venue pages, official organizer pages, and event websites. Use Reddit or social chatter only to judge buzz, never as the only source for date/venue/price.
For event requests, return an "events" array. Each event must have: name, category, date as YYYY-MM-DD, optional date_start/date_end as YYYY-MM-DD, time, venue, area, price, booking_url, source_url, optional image_url from the official listing if available, why_pick, confidence. Only include events whose actual date overlaps the requested window starting today. Do not include old years, past dates, October/November examples, or timeless venue listings.
Return strict JSON with key_insights, statistics, events, trends, quotes, references. Paraphrase in your own words and never reproduce source sentences verbatim. Every statistic or event detail must include source_url, title, and confidence.
Do not invent events. If live search cannot verify enough events, say "Verification Required" inside the JSON fields and include the sources that were checked.`;
}

export function buildPromptImproverPrompt({ prompt, instagramHandle, sourceText, totalSlides }) {
  return `Improve this rough carousel topic into a stronger generation prompt.

Original topic:
${prompt}

Instagram handle: ${instagramHandle || "not supplied"}
Optional source text:
${sourceText || "none"}
Requested slides: ${totalSlides || "not specified"}

Return strict JSON:
{
  "improved_prompt": "the rewritten prompt only"
}

Rules:
- Keep the user's original intent and do not add facts that were not supplied.
- Make it more specific about audience, carousel structure, visual style, research needs, and quality bar.
- If the prompt asks for current events, dates, market data, laws, pricing, or anything time-sensitive, explicitly require live/current source verification and today's date awareness.
- If the user uploaded style references, mention that the carousel should learn the uploaded reference style without copying logos, private marks, personal likenesses, or exact text.
- Ask for realistic, high-quality images only when suitable; for factual metadata such as dates, venue, price, and source, require exact sourced values and no hallucination.
- Keep it concise: 80-180 words.`;
}

export function buildTemplateTextPrompt({ prompt, sourceText, research, template, totalSlides }) {
  return `Write ONLY the text that will be inserted into a locked social-post carousel template.

Topic or URL:
${prompt}

Optional source text:
${sourceText || "none"}

Research:
${JSON.stringify(research).slice(0, 12000)}

Template:
${JSON.stringify({ id: template.id, name: template.name, profileName: template.profileName })}

Return strict JSON only:
{
  "slides": [
    { "slide_number": 1, "title": "3-8 words", "body": "1-2 short sentences" }
  ],
  "caption": "short publish-ready caption",
  "hashtags": ["#tag"]
}

Hard rules:
- Do not design the carousel.
- Do not mention or request images, charts, icons, diagrams, graphs, UI elements, colors, backgrounds, avatars, or layouts.
- Do not output visual_direction, image_search_queries, design_notes, or formatting instructions.
- The app already has a fixed template shell. Only title and body change from slide to slide.
- Write like a text-only creator post split across ${totalSlides} slides: hook, context, insight, proof, implication, takeaway.
- Keep every title readable inside a social post. Avoid generic headings like "Unicorn Density", "Key Stats", "Overview", or "Conclusion".
- Do not hallucinate dates, numbers, names, or claims. If a claim is uncertain, phrase it as an interpretation, not a fact.
- Need exactly ${totalSlides} slides.`;
}

export function buildSlidesPrompt({ prompt, research, brand, style, totalSlides, template }) {
  const templateRules = template
    ? `
Template Studio mode is ON.
Selected template: ${JSON.stringify({ id: template.id, name: template.name, profileName: template.profileName })}
This is a Canva-like locked social text-post template. The renderer will draw the profile photo, profile name, timestamp, menu dots, badge, colors, and slide counter.
Your job is ONLY to write strong text content for each slide.
Do not plan charts, icons, diagrams, tiny graphics, image panels, UI mockups, statistics illustrations, or decorative visual elements.
Every visual_direction must be exactly "locked social text post template".
Write the carousel like a smart founder/creator post split across slides: clear hook, narrative progression, concrete insight, and payoff.
Slide titles can be 3-8 words. Body should be 1-2 short readable sentences. Avoid generic titles like "Key Stats", "Unicorn Density", or "The Future" unless the user specifically asks for a stats carousel.
`
    : "";
  return `Create a research-grounded Instagram carousel plan as strict JSON. Topic: ${prompt}
Research summary: ${JSON.stringify(research).slice(0, 12000)}
Brand: ${JSON.stringify(brand)}
Style: ${JSON.stringify(style)}
${templateRules}
Need ${totalSlides} slides. ${template ? "Follow the Template Studio title/body rules above." : "Each slide title must be 3-6 words. Each body is one short sentence."}
If the topic asks for top events and ${totalSlides} slides, make slide 1 a starter/cover slide explaining the carousel theme, then use the remaining slides for one verified event per slide across varied categories. Copy event date, time, venue, price, booking_url, and source_url exactly from Research events; never invent or substitute older events.
Make the visual directions consistent with the style. ${template ? "Because Template Studio mode is ON, visual_direction must stay locked to the template instructions above." : "If the style is a social_post_screenshot or tweet_like_text_post, the visual direction must be \"text-only social post layout\" for every slide."}
If the user requested a realistic collage starter page, allow slide 1 to be a clean realistic collage based on sourced event/venue visual themes. For all other slides, use one realistic event-relevant image treatment at most and keep the template consistent.
Prefer typography-led slides with minimal diagrams or small accents; do not ask for many photos, busy illustrations, portraits, avatars, screenshots, or unrelated images unless the user's uploaded reference clearly uses photographic event imagery.
Return slides, caption, hashtags, content_plan.`;
}

export function buildImagePrompt({ slide, designSystem, handle, totalSlides }) {
  const normalized = normalizeInstagramHandle(handle);
  return `Create one slide from a multi-slide Instagram carousel. It must look like it belongs to the exact same template family as every other slide in this batch.

Canvas: portrait 4:5.
Reusable design system: ${designSystem.design_brief}
Palette, use only these colors: ${designSystem.color_palette.join(", ")}.
Fonts: ${designSystem.font_styles.join(", ")}.
Alignment/grid: ${designSystem.alignment}.
Reference format: ${designSystem.reference_format}.
Layout rules: ${designSystem.layout_rules.join(" ")}
Consistency rules: ${designSystem.consistency_rules.join(" ")}
Visual density: ${designSystem.visual_density}.
Image policy: ${designSystem.image_policy}.
Fixed chrome policy: ${JSON.stringify(designSystem.fixed_chrome)}.

If the reference format is social_post_screenshot, tweet_like_text_post, or facebook_like_text_post:
- Treat the uploaded image as a UI layout template, not as content to remix.
- Keep the same header/chrome on every slide: same avatar presence, same avatar size, same account-name zone, same badge style, same timestamp text, same menu dots position, same margins.
- Do not use the person's face, name, or profile photo from the reference unless the user explicitly typed that identity. Use the user's handle (${normalized}) or a neutral account label consistently.
- If an avatar is needed, use one small neutral circular placeholder on every slide; never generate real people or changing profile photos.
- If a timestamp is shown, use the exact same timestamp on every slide, preferably "Just now"; never invent changing times like "10h", "2d", or random dates.
- The body is pure large black text on a clean white/off-white background. No photos, no image panels, no illustrations, and no decorative graphics in the post body.
- If the top-right menu dots exist, keep them as menu dots; put any page counter very small at the bottom-right instead of replacing the menu.

Hard rules: all text within at least 10% safe margin, nothing cropped, render text verbatim and correctly spelled, keep wrapped words whole, headline plus at most one short supporting line, flat minimal editorial Instagram design.
Avoid: photorealistic renders, real or generated people, changing avatars, changing profile names, random timestamps, 3D, glossy reflections, busy gradients, neon glow, stock-photo collage, fake UI, abstract swirls, multiple image panels, complex scenes, random icons, noisy backgrounds.
Page number: ${slide.slide_number}/${totalSlides}. For normal editorial templates place it TOP-RIGHT only. For social-post screenshot templates keep menu dots TOP-RIGHT and place the page number small at BOTTOM-RIGHT only. Handle/account source: ${normalized}.
Headline: "${slide.title}". Supporting line: "${slide.body}". Visual direction: ${slide.visual_direction}.`;
}
