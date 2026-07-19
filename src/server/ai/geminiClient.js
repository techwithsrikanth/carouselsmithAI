import { GoogleGenAI } from "@google/genai";
import { extractJson, extractJsonCandidate } from "../utils/json.js";

const defaultTextModel = "gemini-3.1-flash-lite";
const defaultImageModel = "gemini-3-pro-image";

function isQuota(error) {
  const message = String(error?.message || error);
  return message.includes("429") || message.toLowerCase().includes("quota") || message.toLowerCase().includes("credit") || message.includes("limit:0") || message.includes("RESOURCE_EXHAUSTED");
}

function isInteractionSchemaError(error) {
  const message = String(error?.message || error).toLowerCase();
  return message.includes("interactions api schema") || message.includes("upgrade your @google/genai") || message.includes("invalid_request");
}

async function retry(fn, retries = 2) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const message = String(error?.message || error);
      if (!message.includes("503") && !message.includes("429")) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw last;
}

async function parseOrRepairJson(ai, text, textModel) {
  try {
    return extractJson(text);
  } catch (parseError) {
    const candidate = extractJsonCandidate(text);
    const repair = await retry(() =>
      ai.models.generateContent({
        model: textModel,
        contents: `Repair this malformed JSON and return only valid JSON. Do not add markdown, prose, comments, or explanation.\n\n${candidate}`,
        config: {
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    );
    try {
      return extractJson(repair.text);
    } catch {
      const error = new Error(`Gemini returned malformed JSON and repair failed: ${parseError.message}`);
      error.status = 502;
      throw error;
    }
  }
}

async function generateOpenAiImage(prompt, { apiKey, model }) {
  if (!apiKey) return { skipped: true, reason: "OPENAI_API_KEY is not configured." };
  const response = await retry(
    () =>
      fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          prompt,
          size: "1024x1536",
          quality: "medium",
          output_format: "png",
          n: 1
        })
      }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const error = new Error(data.error?.message || `OpenAI image request failed: ${res.status}`);
          error.status = res.status;
          throw error;
        }
        return data;
      }),
    1
  );
  const data = response.data?.[0]?.b64_json;
  return data ? { mimeType: "image/png", data } : { skipped: true, reason: "OpenAI image model returned no image data." };
}

async function repairJsonWithOpenAi(text, { apiKey, model }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Repair this malformed JSON and return only valid JSON. Do not add markdown or prose.\n\n${extractJsonCandidate(text)}`
            }
          ]
        }
      ],
      text: { format: { type: "json_object" } }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || `OpenAI JSON repair failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return extractOpenAiText(data);
}

function extractOpenAiText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join("\n");
}

async function generateOpenAiJson(prompt, { apiKey, model, grounded = false, uploads = [] }) {
  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY is not configured. Set it or switch TEXT_PROVIDER back to gemini.");
    error.status = 503;
    throw error;
  }
  const content = [
    {
      type: "input_text",
      text: `${prompt}

JSON OUTPUT CONTRACT:
- Return only one valid JSON object.
- Do not return markdown, prose, comments, or trailing notes.
- Use double quotes for every key and string.
- If a searched fact is unavailable, use an empty array or "Verification Required" inside JSON.`
    },
    ...uploads.map((upload) => ({
      type: "input_image",
      image_url: `data:${upload.mimeType};base64,${upload.data}`
    }))
  ];
  const body = buildOpenAiTextBody({ model, content, grounded });
  const response = await retry(
    () =>
      fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      }).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const error = new Error(data.error?.message || `OpenAI text request failed: ${res.status}`);
          error.status = res.status;
          throw error;
        }
        return data;
      }),
    1
  );
  const text = extractOpenAiText(response);
  try {
    return { json: extractJson(text), groundingMetadata: {} };
  } catch {
    return { json: extractJson(await repairJsonWithOpenAi(text, { apiKey, model })), groundingMetadata: {} };
  }
}

export function buildOpenAiTextBody({ model, content, grounded = false }) {
  const body = {
    model,
    input: [{ role: "user", content }]
  };
  if (grounded) {
    body.tools = [{ type: "web_search_preview" }];
  } else {
    body.text = { format: { type: "json_object" } };
  }
  return body;
}

export function createGeminiClient(apiKey, options = {}) {
  const textModel = options.textModel || defaultTextModel;
  const imageModel = options.imageModel || defaultImageModel;
  const openaiApiKey = options.openaiApiKey || "";
  const openaiTextModel = options.openaiTextModel || "gpt-4.1-mini";
  const openaiImageModel = options.openaiImageModel || "gpt-image-1-mini";
  const textProvider = options.textProvider || "gemini";
  const imageProvider = options.imageProvider || "gemini";
  const imageFallbackProvider = options.imageFallbackProvider || "";
  if (!apiKey && textProvider !== "openai") {
    return {
      configured: false,
      async generateJson() {
        const error = new Error("GEMINI_API_KEY is not configured. Real generation is unavailable.");
        error.status = 503;
        throw error;
      },
      async generateImage() {
        const error = new Error("GEMINI_API_KEY is not configured. Image generation is unavailable.");
        error.status = 503;
        throw error;
      }
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  return {
    configured: true,
    async generateJson(prompt, { grounded = false, uploads = [] } = {}) {
      if (textProvider === "openai") {
        return generateOpenAiJson(prompt, { apiKey: openaiApiKey, model: openaiTextModel, grounded, uploads });
      }
      const jsonPrompt = `${prompt}

JSON OUTPUT CONTRACT:
- Return only one valid JSON object.
- Do not return markdown, prose, simulated search results, headings, comments, or trailing notes.
- Use double quotes for every key and string.
- If a searched fact is unavailable, use an empty array or "Verification Required" inside the JSON instead of explaining outside JSON.`;
      const makeContents = (nextPrompt) => uploads.length
        ? [
            {
              role: "user",
              parts: [
                { text: nextPrompt },
                ...uploads.map((upload) => ({
                  inlineData: {
                    mimeType: upload.mimeType,
                    data: upload.data
                  }
                }))
              ]
            }
          ]
        : nextPrompt;
      const generate = (nextPrompt) => retry(() =>
        ai.models.generateContent({
          model: textModel,
          contents: makeContents(nextPrompt),
          config: {
            responseMimeType: grounded ? undefined : "application/json",
            thinkingConfig: { thinkingBudget: 0 },
            tools: grounded ? [{ googleSearch: {} }] : undefined
          }
        })
      );
      let response = await generate(jsonPrompt);
      let json;
      try {
        json = await parseOrRepairJson(ai, response.text, textModel);
      } catch (firstError) {
        response = await generate(`${jsonPrompt}

Your previous response was invalid JSON. Retry from scratch.
Return only valid JSON. Do not include simulated search output, analysis text, or markdown.
Previous invalid response:
${String(response.text || "").slice(0, 6000)}`);
        try {
          json = await parseOrRepairJson(ai, response.text, textModel);
        } catch {
          throw firstError;
        }
      }
      return { json, groundingMetadata: response.candidates?.[0]?.groundingMetadata || {} };
    },
    async generateImage(prompt) {
      if (imageProvider === "openai") {
        try {
          return await generateOpenAiImage(prompt, { apiKey: openaiApiKey, model: openaiImageModel });
        } catch (error) {
          if (isQuota(error)) return { quotaHalt: true, reason: String(error?.message || error) };
          throw error;
        }
      }
      try {
        if (ai.interactions?.create && imageModel.startsWith("gemini-3")) {
          try {
            const interaction = await retry(
              () =>
                ai.interactions.create({
                  model: imageModel,
                  input: prompt
                }),
              1
            );
            const generatedImage = interaction.output_image || interaction.outputImage;
            if (generatedImage?.data) return { mimeType: generatedImage.mimeType || generatedImage.mime_type || "image/png", data: generatedImage.data };
          } catch (error) {
            if (!isInteractionSchemaError(error)) throw error;
          }
        }
        const response = await retry(
          () =>
            ai.models.generateContent({
              model: imageModel,
              contents: prompt,
              config: { responseFormat: { image: { aspectRatio: "4:5", imageSize: "2K" } } }
            }),
          1
        );
        const part = response.candidates?.[0]?.content?.parts?.find((item) => item.inlineData);
        if (!part) return { skipped: true, reason: "Image model returned no inline image." };
        return { mimeType: part.inlineData.mimeType, data: part.inlineData.data };
      } catch (error) {
        if (isQuota(error)) {
          if (imageFallbackProvider === "openai" && openaiApiKey) {
            return generateOpenAiImage(prompt, { apiKey: openaiApiKey, model: openaiImageModel });
          }
          return { quotaHalt: true, reason: String(error?.message || error) };
        }
        throw error;
      }
    }
  };
}
