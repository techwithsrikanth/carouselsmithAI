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

function isHexColor(value = "") {
  return /^#[0-9a-f]{6}$/i.test(String(value));
}

function colorOr(value, fallback) {
  return isHexColor(value) ? value : fallback;
}

function imageHref(upload) {
  if (!upload?.data || !String(upload.mimeType || "").startsWith("image/")) return "";
  return `data:${upload.mimeType};base64,${String(upload.data).replace(/^data:[^;]+;base64,/, "")}`;
}

function displayNameFromHandle(handle = "") {
  const normalized = normalizeInstagramHandle(handle);
  const clean = normalized.replace(/^@/, "").replace(/[._-]+/g, " ").trim();
  if (!clean) return "Profile Name";
  return clean
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function wrapText(text, maxChars, maxLines = 8) {
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

function textBlock(lines, { x, y, size, weight = 500, lineHeight, color = "#111111" }) {
  return lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : lineHeight;
      return `<text x="${x}" y="${y + dy * index}" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(line)}</text>`;
    })
    .join("\n");
}

export function isSocialPostDesign(style = {}) {
  const format = String(style.reference_format || "").toLowerCase();
  return ["social_post_screenshot", "tweet_like_text_post", "facebook_like_text_post"].includes(format);
}

export function renderSocialPostSlide({ slide, handle, totalSlides, generatedDir, batchId = Date.now(), template = {} }) {
  fs.mkdirSync(generatedDir, { recursive: true });
  const name = String(template.profileName || "").trim().slice(0, 42) || displayNameFromHandle(handle);
  const avatar = imageHref(template.avatarUpload);
  const backgroundColor = colorOr(template.backgroundColor, "#ffffff");
  const textColor = colorOr(template.textColor, "#111111");
  const mutedColor = colorOr(template.mutedColor, "#737373");
  const borderColor = colorOr(template.borderColor, "#dedbd4");
  const badgeColor = colorOr(template.badgeColor, "#2374d5");
  const timestamp = String(template.timestamp || "Just now").slice(0, 24);
  const headlineLines = wrapText(slide.title, 17, 3);
  const bodyLines = wrapText(slide.body, 32, 7);
  const badgeX = 190 + Math.min(name.length * 18, 270);
  const filename = `carousel-${batchId}-${slide.slide_number}.svg`;
  const filePath = path.join(generatedDir, filename);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" rx="40" fill="${backgroundColor}"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="39" fill="none" stroke="${borderColor}" stroke-width="2"/>

  <defs>
    <clipPath id="avatarClip"><circle cx="112" cy="106" r="44"/></clipPath>
  </defs>
  <circle cx="112" cy="106" r="44" fill="#e9e4dc" stroke="#d6d1c8" stroke-width="2"/>
  ${avatar ? `<image x="68" y="62" width="88" height="88" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" href="${avatar}"/>` : `<circle cx="112" cy="91" r="16" fill="#ffffff"/>
  <path d="M78 135c8-24 26-36 34-36s26 12 34 36" fill="#ffffff"/>`}

  <text x="174" y="94" font-size="36" font-weight="800" fill="${textColor}">${escapeXml(name)}</text>
  <circle cx="${badgeX}" cy="82" r="15" fill="${badgeColor}"/>
  <path d="M${badgeX - 7} 82l5 6 10-13" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="174" y="132" font-size="29" font-weight="400" fill="${mutedColor}">${escapeXml(timestamp)} ·</text>

  <circle cx="965" cy="96" r="7" fill="${mutedColor}"/>
  <circle cx="990" cy="96" r="7" fill="${mutedColor}"/>
  <circle cx="1015" cy="96" r="7" fill="${mutedColor}"/>

  ${textBlock(headlineLines, { x: 112, y: 305, size: 70, weight: 850, lineHeight: 76, color: textColor })}
  ${textBlock(bodyLines, { x: 112, y: 535 + Math.max(0, headlineLines.length - 1) * 54, size: 45, weight: 450, lineHeight: 58, color: textColor })}

  <text x="980" y="1288" text-anchor="end" font-size="30" font-weight="500" fill="${textColor}">${slide.slide_number}/${totalSlides}</text>
</svg>`;
  fs.writeFileSync(filePath, svg, "utf8");
  return {
    slide_number: slide.slide_number,
    url: `/generated/${filename}`,
    image_prompt: `Deterministic social post renderer: account=${name}, timestamp=${timestamp}, slide=${slide.slide_number}/${totalSlides}`
  };
}
