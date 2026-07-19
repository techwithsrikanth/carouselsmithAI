import fs from "node:fs";
import path from "node:path";
import { normalizeInstagramHandle } from "../utils/handle.js";

const width = 1080;
const height = 1350;

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text, maxChars, maxLines = 4) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function clampLines(lines, maxLines) {
  const next = lines.slice(0, maxLines);
  if (lines.length > maxLines && next.length) next[next.length - 1] = `${next[next.length - 1].replace(/\.*$/, "")}...`;
  return next;
}

function textLines(lines, { x, y, size, weight = 700, lineHeight, color = "#ffffff", anchor = "start" }) {
  return lines
    .map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" text-anchor="${anchor}" font-family="Impact, Arial Black, Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" letter-spacing="1">${escapeXml(line)}</text>`)
    .join("\n");
}

function displayDate(value = "") {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return value || "Date TBA";
  const parsed = new Date(`${date}T00:00:00Z`);
  return parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function shortText(value = "", max = 48) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function categoryColors(category = "") {
  const normalized = category.toLowerCase();
  if (normalized.includes("food")) return ["#22140c", "#d08b3e", "#fff2d6"];
  if (normalized.includes("comedy")) return ["#18080b", "#9d232f", "#f5d3d0"];
  if (normalized.includes("music")) return ["#080d20", "#375bd2", "#d6e2ff"];
  if (normalized.includes("art") || normalized.includes("culture")) return ["#11110e", "#c94f3b", "#f7e6bf"];
  if (normalized.includes("tech") || normalized.includes("startup")) return ["#061819", "#1d8f81", "#d7fff7"];
  return ["#080808", "#c94f3b", "#fffdfa"];
}

function pill(text, { x, y, color }) {
  const width = Math.max(116, Math.min(330, String(text || "").length * 15 + 34));
  return `<rect x="${x}" y="${y}" width="${width}" height="48" rx="20" fill="${color}" opacity=".94"/>
  <text x="${x + 18}" y="${y + 32}" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="900" fill="#ffffff">${escapeXml(String(text || "").toUpperCase())}</text>`;
}

function metaRow(icon, label, value, y) {
  return `<text x="78" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="900" fill="#ffffff" letter-spacing="1">${escapeXml(label)}</text>
  <text x="210" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="500" fill="#f4efe8">${escapeXml(shortText(value || "Verification Required", 46))}</text>`;
}

function bottomGradient(y = 610, opacity = 0.86) {
  return `<defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset=".32" stop-color="#000000" stop-opacity=".62"/>
      <stop offset="1" stop-color="#000000" stop-opacity="${opacity}"/>
    </linearGradient>
  </defs>
  <rect x="34" y="${y}" width="1012" height="${1316 - y}" rx="36" fill="url(#fade)"/>`;
}

function backgroundImage(backgroundImage, opacity = 1) {
  if (!backgroundImage?.data) return "";
  const mimeType = backgroundImage.mimeType || "image/png";
  return `<image x="34" y="34" width="1012" height="1282" preserveAspectRatio="xMidYMid slice" href="data:${escapeXml(mimeType)};base64,${backgroundImage.data}" opacity="${opacity}"/>`;
}

function coverSvg({ slide, handle, totalSlides, backgroundImage: bg }) {
  const title = clampLines(wrapText(slide.title || "Bengaluru's Top Events", 16, 3), 3);
  const body = clampLines(wrapText(slide.body || "A verified guide to what is happening around town.", 34, 2), 2);
  const normalized = normalizeInstagramHandle(handle);
  const titleY = 650;
  const bodyY = titleY + title.length * 78 + 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#080808"/>
  <rect x="34" y="34" width="1012" height="1282" rx="36" fill="#0b0b0b" stroke="#24211d" stroke-width="2"/>
  ${backgroundImage(bg, 1)}
  <rect x="34" y="34" width="1012" height="1282" rx="36" fill="#000000" opacity=".26"/>
  ${bottomGradient(560, .9)}
  <rect x="890" y="64" width="116" height="58" rx="29" fill="#050505" opacity=".8"/>
  <text x="948" y="102" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="800" fill="#ffffff">${slide.slide_number}/${totalSlides}</text>
  <text x="78" y="580" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="850" fill="#e8e1d7">${escapeXml(normalized || "@things2doinblr")}</text>
  ${textLines(title, { x: 78, y: titleY, size: 78, weight: 950, lineHeight: 78 })}
  ${textLines(body, { x: 82, y: bodyY, size: 30, weight: 600, lineHeight: 39, color: "#fffdfa" })}
  <line x1="78" y1="1114" x2="1002" y2="1114" stroke="#fffdfa" stroke-width="2" opacity=".46"/>
  ${metaRow("", "CITY", "Bengaluru", 1172)}
  ${metaRow("", "DATES", slide.event_details?.date || "Next 5 days", 1222)}
  ${metaRow("", "SOURCES", "District, Luma, AllEvents, official pages", 1272)}
  </svg>`;
}

function eventSvg({ slide, handle, totalSlides, backgroundImage: bg }) {
  const event = slide.event_details || {};
  const [base, accent, soft] = categoryColors(event.category || slide.visual_direction);
  const title = wrapText(slide.title || event.name || "Verified Event", 13, 3);
  const body = wrapText(slide.body || event.why_pick || "Verified from an event source.", 40, 3);
  const normalized = normalizeInstagramHandle(handle);
  let sourceHost = "Verified source";
  try {
    if (event.source_url) sourceHost = new URL(event.source_url).hostname.replace(/^www\./, "");
  } catch {
    sourceHost = "Verified source";
  }
  if (event.cta) return ctaSvg({ slide, handle, totalSlides, backgroundImage: bg });
  const titleLines = clampLines(wrapText(slide.title || event.name || "Verified Event", 14, 3), 3);
  const bodyLines = clampLines(wrapText(slide.body || event.why_pick || "Verified from an event source.", 34, 2), 2);
  const titleY = 762;
  const bodyY = titleY + titleLines.length * 67 + 34;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f6f4ef"/>
  <rect x="34" y="34" width="1012" height="1282" rx="36" fill="${base}"/>
  ${backgroundImage(bg, 1)}
  <rect x="34" y="34" width="1012" height="1282" rx="36" fill="#000000" opacity="${bg?.data ? ".14" : "0"}"/>
  ${bottomGradient(585, .93)}
  ${pill(event.category || "EVENT", { x: 78, y: 74, color: accent })}
  <rect x="884" y="74" width="106" height="54" rx="27" fill="#050505" opacity=".78"/>
  <text x="938" y="110" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="700" fill="#ffffff">${slide.slide_number}/${totalSlides}</text>
  <text x="78" y="692" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="800" fill="#d8d1c8">${escapeXml(normalized || "@things2doinblr")}</text>
  ${textLines(titleLines, { x: 78, y: titleY, size: 65, weight: 950, lineHeight: 67 })}
  ${textLines(bodyLines, { x: 82, y: bodyY, size: 27, weight: 500, lineHeight: 36, color: "#fffdfa" })}
  <line x1="78" y1="1114" x2="1002" y2="1114" stroke="#fffdfa" stroke-width="2" opacity=".42"/>
  ${metaRow("", "VENUE", [event.venue, event.area].filter(Boolean).join(", "), 1172)}
  ${metaRow("", "DATE", [displayDate(event.date || event.date_start), event.time].filter(Boolean).join(" - "), 1222)}
  ${metaRow("", "PRICE", event.price || "Check listing", 1272)}
  <text x="88" y="1306" font-family="Arial, Helvetica, sans-serif" font-size="21" font-weight="700" fill="#d7d0c8">Source: ${escapeXml(sourceHost)}</text>
  </svg>`;
}

function ctaSvg({ slide, handle, totalSlides, backgroundImage: bg }) {
  const normalized = normalizeInstagramHandle(handle);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#050505"/>
  <rect x="34" y="34" width="1012" height="1282" rx="36" fill="#07090b"/>
  ${backgroundImage(bg, 1)}
  <rect x="34" y="34" width="1012" height="1282" rx="36" fill="#000000" opacity=".52"/>
  <rect x="884" y="74" width="106" height="54" rx="27" fill="#050505" opacity=".78"/>
  <text x="938" y="110" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="700" fill="#ffffff">${slide.slide_number}/${totalSlides}</text>
  <path d="M510 330c-26-34-78 0-45 48l75 78 75-78c33-48-19-82-45-48-12 16-18 16-30 0-12 16-18 16-30 0Z" fill="none" stroke="#f2c55c" stroke-width="6" stroke-linejoin="round"/>
  ${textLines(wrapText(slide.title, 15, 3), { x: 540, y: 650, size: 72, weight: 950, lineHeight: 76, anchor: "middle" })}
  ${textLines(wrapText(slide.body, 30, 3), { x: 540, y: 842, size: 34, weight: 500, lineHeight: 44, anchor: "middle", color: "#fffdfa" })}
  <text x="540" y="1088" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="700" fill="#ffffff">SAVE FOR LATER</text>
  <text x="540" y="1140" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="500" fill="#d7d0c8">FOLLOW ${escapeXml(normalized || "@things2doinblr")} FOR MORE</text>
  </svg>`;
}

export function renderEventPosterSlide({ slide, handle, totalSlides, generatedDir, batchId = Date.now(), backgroundImage: bg, imagePrompt = "" }) {
  fs.mkdirSync(generatedDir, { recursive: true });
  const filename = `carousel-${batchId}-event-${slide.slide_number}.svg`;
  const filePath = path.join(generatedDir, filename);
  const svg = slide.slide_number === 1
    ? coverSvg({ slide, handle, totalSlides, backgroundImage: bg })
    : eventSvg({ slide, handle, totalSlides, backgroundImage: bg });
  fs.writeFileSync(filePath, svg, "utf8");
  return {
    slide_number: slide.slide_number,
    url: `/generated/${filename}`,
    image_prompt: imagePrompt || "Deterministic event poster renderer: sourced fields rendered by code to avoid text overlap and wrong dates."
  };
}
