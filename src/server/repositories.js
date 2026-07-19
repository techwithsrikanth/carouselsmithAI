import { inTransaction } from "./db.js";
import { summarizePrompt } from "./utils/summary.js";

const bind = (stmt, method, params) => (Array.isArray(params) ? stmt[method](...params) : stmt[method](params));
const row = (stmt, params = {}) => bind(stmt, "get", params) || null;
const all = (stmt, params = {}) => bind(stmt, "all", params);

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
    carousel_id: carousel.id,
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
  return {
    users: {
      create({ email, passwordHash }) {
        const result = db.prepare("INSERT INTO Users (email, password_hash) VALUES (?, ?)").run(email, passwordHash);
        return this.findById(Number(result.lastInsertRowid));
      },
      findByEmail(email) {
        return row(db.prepare("SELECT * FROM Users WHERE email = ?"), [email]);
      },
      findById(id) {
        return row(db.prepare("SELECT * FROM Users WHERE id = ?"), [id]);
      },
      delete(id) {
        db.prepare("DELETE FROM Users WHERE id = ?").run(id);
      }
    },
    brands: {
      upsertForUser(userId, data) {
        db.prepare(`
          INSERT INTO BrandProfiles (user_id, company_name, handle, logo_url, custom_style_json)
          VALUES (@userId, @companyName, @handle, @logoUrl, @styleJson)
        `).run({
          userId,
          companyName: data.companyName || "",
          handle: data.handle || "",
          logoUrl: data.logoUrl || "",
          styleJson: JSON.stringify(data.customStyle || {})
        });
      }
    },
    carousels: {
      createWithSlides({ userId, prompt, promptSummary, slides, images = [], artifact = {} }) {
        return inTransaction(db, () => {
          const result = db.prepare("INSERT INTO Carousels (user_id, prompt, prompt_summary, artifact_json, total_slides) VALUES (?, ?, ?, ?, ?)").run(
            userId,
            prompt,
            promptSummary || summarizePrompt(prompt),
            JSON.stringify(artifact || {}),
            slides.length
          );
          const carouselId = Number(result.lastInsertRowid);
          const insertSlide = db.prepare(`
            INSERT INTO Slides (carousel_id, slide_index, hook_or_body_text, asset_layout_type, visual_mock_data)
            VALUES (@carouselId, @slideIndex, @text, @layout, @visual)
          `);
          const imagesBySlide = new Map(images.map((image) => [image.slide_number, image]));
          for (const slide of slides) {
            const image = imagesBySlide.get(slide.slide_number);
            const visualData = {
              ...slide,
              ...(image?.url ? { image_url: image.url } : {}),
              ...(image?.image_prompt ? { image_prompt: image.image_prompt } : {})
            };
            insertSlide.run({
              carouselId,
              slideIndex: slide.slide_number,
              text: `${slide.title}: ${slide.body}`,
              layout: slide.visual_direction || "editorial",
              visual: JSON.stringify(visualData)
            });
          }
          return this.findOwned(userId, carouselId);
        });
      },
      findOwned(userId, carouselId) {
        const carousel = row(db.prepare("SELECT * FROM Carousels WHERE id = ? AND user_id = ?"), [carouselId, userId]);
        if (!carousel) return null;
        carousel.slides = all(db.prepare("SELECT * FROM Slides WHERE carousel_id = ? ORDER BY slide_index"), [carouselId]);
        return carousel;
      },
      findResultOwned(userId, carouselId) {
        const carousel = this.findOwned(userId, carouselId);
        return carousel ? toCarouselResult(carousel) : null;
      },
      deleteOwned(userId, carouselId) {
        const result = db.prepare("DELETE FROM Carousels WHERE id = ? AND user_id = ?").run(carouselId, userId);
        return result.changes > 0;
      },
      listForUser(userId) {
        return all(
          db.prepare(`
            SELECT
              id,
              user_id,
              prompt,
              prompt_summary,
              total_slides,
              created_at
            FROM Carousels
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
          `),
          [userId]
        ).map((carousel) => ({
          ...carousel,
          prompt_summary: carousel.prompt_summary || summarizePrompt(carousel.prompt)
        }));
      }
    },
    socialConnections: {
      upsert(userId, provider, connection) {
        db.prepare(`
          INSERT INTO SocialConnections (user_id, provider, access_token, refresh_token, expires_at, account_id, account_name)
          VALUES (@userId, @provider, @accessToken, @refreshToken, @expiresAt, @accountId, @accountName)
          ON CONFLICT(user_id, provider) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            expires_at = excluded.expires_at,
            account_id = excluded.account_id,
            account_name = excluded.account_name
        `).run({
          userId,
          provider,
          accessToken: connection.accessToken,
          refreshToken: connection.refreshToken || "",
          expiresAt: connection.expiresAt || "",
          accountId: connection.accountId || "",
          accountName: connection.accountName || ""
        });
      },
      find(userId, provider) {
        return row(db.prepare("SELECT * FROM SocialConnections WHERE user_id = ? AND provider = ?"), [userId, provider]);
      }
    }
  };
}
