export function extractJson(text) {
  return JSON.parse(extractJsonCandidate(text));
}

export function extractJsonCandidate(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  const arrayStart = raw.indexOf("[");
  const arrayEnd = raw.lastIndexOf("]");
  if (objectStart >= 0 && objectEnd > objectStart) return raw.slice(objectStart, objectEnd + 1);
  if (arrayStart >= 0 && arrayEnd > arrayStart) return raw.slice(arrayStart, arrayEnd + 1);
  return raw;
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}
