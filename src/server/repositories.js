import crypto from "node:crypto";
import { summarizePrompt } from "./utils/summary.js";

// Public ids are UUIDs; anything purely numeric is treated as an internal row id.
const isPublicId = (value) => typeof value === "string" && !/^\d+$/.test(value.trim());

function parseSlideData(slideRow) {
  try {
    return JSON.parse(slideRow.visual_mock_data);
  } catch {
    return {
      slide_number: slideRow.slide_index,
      title: slideRow.hook_or_body_text,
      body: "",
      visual_direction: slideRow.asset_layout_type
    };
  }
}

function toCarouselResult(carousel) {
  const slides = (carousel.slides || []).map(parseSlideData);
  const images = slides
    .filter((slide) => slide.image_url || slide.generated_image_url)
    .map((slide) => ({
      slide_number: slide.slide_number,
      url: slide.image_url || slide.generated_image_url,
      image_prompt: slide.image_prompt || ""
    }));
  let artifact = {};
  try {
    artifact = carousel.artifact_json ? JSON.parse(carousel.artifact_json) : {};
  } catch {
    artifact = {};
  }
  return {
    ...artifact,
    // Always the public id: the row id is not stable across instances or deployments.
    carousel_id: carousel.public_id,
    created_at: carousel.created_at,
    prompt: carousel.prompt,
    prompt_summary: carousel.prompt_summary || summarizePrompt(carousel.prompt),
    generation_input: artifact.generation_input || {
      prompt: carousel.prompt,
      instagramHandle: "",
      sourceText: "",
      totalSlides: carousel.total_slides
    },
    research_summary: artifact.research_summary || [],
    sources_used: artifact.sources_used || [],
    style_analysis: artifact.style_analysis || {},
    brand_analysis: artifact.brand_analysis || {},
    content_plan: artifact.content_plan || {},
    slides: artifact.slides?.length ? artifact.slides : slides,
    image_recommendations: artifact.image_recommendations || slides.flatMap((slide) => slide.image_search_queries || []),
    caption: artifact.caption || "",
    hashtags: artifact.hashtags || [],
    fact_check: artifact.fact_check || [],
    images_generated: artifact.images_generated?.length ? artifact.images_generated : images
  };
}

export function createRepositories(db) {
  const carousels = {
    async createWithSlides({ userId, prompt, promptSummary, slides, images = [], artifact = {} }) {
      // Generated up front so the row can be read back by public id after the commit,
      // without depending on a row id that is only unique within one database.
      const publicId = crypto.randomUUID();
      await db.transaction(async (tx) => {
        const result = await tx.run(
          "INSERT INTO Carousels (user_id, prompt, prompt_summary, artifact_json, total_slides, public_id, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            userId,
            prompt,
            promptSummary || summarizePrompt(prompt),
            JSON.stringify(artifact || {}),
            slides.length,
            publicId,
            Date.now()
          ]
        );
        const carouselId = Number(result.lastInsertRowid);
        const imagesBySlide = new Map(images.map((image) => [image.slide_number, image]));
        for (const slide of slides) {
          const image = imagesBySlide.get(slide.slide_number);
          const visualData = {
            ...slide,
            ...(image?.url ? { image_url: image.url } : {}),
            ...(image?.image_prompt ? { image_prompt: image.image_prompt } : {})
          };
          await tx.run(
            "INSERT INTO Slides (carousel_id, slide_index, hook_or_body_text, asset_layout_type, visual_mock_data) VALUES (?, ?, ?, ?, ?)",
            [carouselId, slide.slide_number, `${slide.title}: ${slide.body}`, slide.visual_direction || "editorial", JSON.stringify(visualData)]
          );
        }
      });
      return carousels.findOwned(userId, publicId);
    },
    // Accepts the public id (what the API and client use) or the internal row id.
    async findOwned(userId, carouselId) {
      if (carouselId === null || carouselId === undefined || carouselId === "") return null;
      const carousel = isPublicId(carouselId)
        ? await db.get("SELECT * FROM Carousels WHERE public_id = ? AND user_id = ?", [String(carouselId), userId])
        : await db.get("SELECT * FROM Carousels WHERE id = ? AND user_id = ?", [Number(carouselId), userId]);
      if (!carousel) return null;
      carousel.slides = await db.all("SELECT * FROM Slides WHERE carousel_id = ? ORDER BY slide_index", [carousel.id]);
      return carousel;
    },
    async findResultOwned(userId, carouselId) {
      const carousel = await carousels.findOwned(userId, carouselId);
      return carousel ? toCarouselResult(carousel) : null;
    },
    async deleteOwned(userId, carouselId) {
      if (carouselId === null || carouselId === undefined || carouselId === "") return false;
      const result = isPublicId(carouselId)
        ? await db.run("DELETE FROM Carousels WHERE public_id = ? AND user_id = ?", [String(carouselId), userId])
        : await db.run("DELETE FROM Carousels WHERE id = ? AND user_id = ?", [Number(carouselId), userId]);
      return result.changes > 0;
    },
    async listForUser(userId) {
      const rows = await db.all(
        `SELECT
           public_id AS id,
           user_id,
           prompt,
           prompt_summary,
           total_slides,
           created_at,
           created_at_ms
         FROM Carousels
         WHERE user_id = ?
         ORDER BY created_at_ms DESC, Carousels.id DESC`,
        [userId]
      );
      return rows.map((carousel) => ({
        ...carousel,
        prompt_summary: carousel.prompt_summary || summarizePrompt(carousel.prompt)
      }));
    }
  };

  const users = {
    async create({ email, passwordHash, emailVerified = 0 }) {
      const result = await db.run("INSERT INTO Users (email, password_hash, email_verified) VALUES (?, ?, ?)", [
        email,
        passwordHash,
        emailVerified ? 1 : 0
      ]);
      return users.findById(Number(result.lastInsertRowid));
    },
    // Lets an unverified signup correct a typo'd password before the address is ever proven.
    async replacePassword(id, passwordHash) {
      await db.run("UPDATE Users SET password_hash = ? WHERE id = ?", [passwordHash, id]);
      return users.findById(id);
    },
    async markVerified(id) {
      await db.run("UPDATE Users SET email_verified = 1, verified_at = ? WHERE id = ?", [new Date().toISOString(), id]);
      return users.findById(id);
    },
    async findByEmail(email) {
      return db.get("SELECT * FROM Users WHERE email = ?", [email]);
    },
    async findById(id) {
      return db.get("SELECT * FROM Users WHERE id = ?", [id]);
    },
    async delete(id) {
      await db.run("DELETE FROM Users WHERE id = ?", [id]);
    }
  };

  return {
    users,
    carousels,
    emailOtps: {
      async create({ email, purpose, codeHash, createdAtMs, expiresAtMs }) {
        await db.run(
          "INSERT INTO EmailOtps (email, purpose, code_hash, created_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?)",
          [email, purpose, codeHash, createdAtMs, expiresAtMs]
        );
      },
      // Newest unconsumed, unexpired code for this address and purpose.
      async findActive(email, purpose) {
        return db.get(
          "SELECT * FROM EmailOtps WHERE email = ? AND purpose = ? AND consumed_at_ms IS NULL ORDER BY id DESC LIMIT 1",
          [email, purpose]
        );
      },
      async recentFor(email, purpose, sinceMs) {
        return db.all(
          "SELECT * FROM EmailOtps WHERE email = ? AND purpose = ? AND created_at_ms >= ? ORDER BY id DESC",
          [email, purpose, sinceMs]
        );
      },
      async invalidateActive(email, purpose, atMs) {
        await db.run(
          "UPDATE EmailOtps SET consumed_at_ms = ? WHERE email = ? AND purpose = ? AND consumed_at_ms IS NULL",
          [atMs, email, purpose]
        );
      },
      async recordAttempt(id) {
        await db.run("UPDATE EmailOtps SET attempts = attempts + 1 WHERE id = ?", [id]);
      },
      async consume(id, atMs) {
        await db.run("UPDATE EmailOtps SET consumed_at_ms = ? WHERE id = ?", [atMs, id]);
      }
    },
    brands: {
      async upsertForUser(userId, data) {
        await db.run(
          "INSERT INTO BrandProfiles (user_id, company_name, handle, logo_url, custom_style_json) VALUES (?, ?, ?, ?, ?)",
          [userId, data.companyName || "", data.handle || "", data.logoUrl || "", JSON.stringify(data.customStyle || {})]
        );
      }
    },
    socialConnections: {
      async upsert(userId, provider, connection) {
        await db.run(
          `INSERT INTO SocialConnections (user_id, provider, access_token, refresh_token, expires_at, account_id, account_name)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, provider) DO UPDATE SET
             access_token = excluded.access_token,
             refresh_token = excluded.refresh_token,
             expires_at = excluded.expires_at,
             account_id = excluded.account_id,
             account_name = excluded.account_name`,
          [
            userId,
            provider,
            connection.accessToken,
            connection.refreshToken || "",
            connection.expiresAt || "",
            connection.accountId || "",
            connection.accountName || ""
          ]
        );
      },
      async find(userId, provider) {
        return db.get("SELECT * FROM SocialConnections WHERE user_id = ? AND provider = ?", [userId, provider]);
      }
    }
  };
}
