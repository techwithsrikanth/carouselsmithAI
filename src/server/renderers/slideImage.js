import fs from "node:fs";
import path from "node:path";
import { buildSocialPostSvg } from "./socialPostRenderer.js";
import { buildEventPosterSvg } from "./eventPosterRenderer.js";

/**
 * Slide images are rebuilt on demand rather than served from disk.
 *
 * Generated files live in the local filesystem, which on Vercel is a per-instance /tmp that
 * is wiped between cold starts and never shared. A slide whose file was written by one
 * instance therefore 404s when the request lands on another. Both SVG renderers are pure, so
 * anything they produced can be regenerated from the record already stored in the database.
 */

/**
 * Records written before this existed only carry a `/generated/...` URL, so fall back to the
 * filename convention the renderers have always used.
 */
export function rendererKindFor(image = {}) {
  if (image.renderer) return image.renderer;
  const name = String(image.file || image.url || "");
  if (!name.endsWith(".svg")) return "model";
  return name.includes("-event-") ? "event_poster" : "social_post";
}

export function isRebuildable(image = {}) {
  return rendererKindFor(image) !== "model";
}

/**
 * The URL the client should request for a slide. Rebuildable slides point at the API route
 * so they never depend on a file; model-generated PNGs keep the static path.
 */
export function slideImageUrl(publicId, image = {}) {
  if (!publicId || !isRebuildable(image)) return image.url || "";
  return `/api/carousels/${publicId}/slides/${image.slide_number}.svg`;
}

function localFile(image, generatedDirs = []) {
  const name = image.file || (image.url ? path.basename(image.url) : "");
  if (!name) return null;
  for (const dir of generatedDirs) {
    const filePath = path.resolve(dir, name);
    const root = `${path.resolve(dir)}${path.sep}`;
    if (filePath.startsWith(root) && fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function placeholderSvg(message) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <rect width="1080" height="1350" rx="40" fill="#f4f1ea"/>
  <rect x="1" y="1" width="1078" height="1348" rx="39" fill="none" stroke="#ded9cf" stroke-width="2"/>
  <text x="540" y="660" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#6b6459">Slide image unavailable</text>
  <text x="540" y="712" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#8a8175">${message}</text>
</svg>`;
}

/**
 * Resolves a slide to renderable bytes.
 * Returns { svg } for anything rebuildable, { filePath } when a real file is still present,
 * or { svg } holding a labelled placeholder when a model-generated image is gone for good.
 */
export function resolveSlideImage({ carousel, slideNumber, generatedDirs = [] }) {
  const number = Number(slideNumber);
  const image = (carousel.images_generated || []).find((entry) => Number(entry.slide_number) === number);
  const slide = (carousel.slides || []).find((entry) => Number(entry.slide_number) === number);
  if (!slide) return null;

  const kind = rendererKindFor(image || {});
  const totalSlides = carousel.slides?.length || carousel.total_slides || 1;
  const input = carousel.generation_input || {};

  if (kind === "social_post") {
    return {
      svg: buildSocialPostSvg({
        slide,
        handle: input.instagramHandle || "",
        totalSlides,
        template: input.template || { avatarUpload: input.profilePhotoUpload || null }
      })
    };
  }

  if (kind === "event_poster") {
    // The background photo is not stored, so an existing file is preferred when present; the
    // rebuild without it keeps every sourced field readable.
    const filePath = localFile(image || {}, generatedDirs);
    if (filePath) return { filePath };
    return {
      svg: buildEventPosterSvg({
        slide,
        handle: input.instagramHandle || "",
        totalSlides,
        backgroundImage: null
      })
    };
  }

  const filePath = localFile(image || {}, generatedDirs);
  if (filePath) return { filePath };
  if (image?.skipped) return { svg: placeholderSvg(String(image.reason || "Image generation was skipped.").slice(0, 64)) };
  return { svg: placeholderSvg("The generated image file is no longer on this server.") };
}
