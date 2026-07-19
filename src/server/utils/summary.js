const stopwords = new Set([
  "about",
  "across",
  "after",
  "again",
  "agent",
  "agents",
  "also",
  "and",
  "are",
  "article",
  "based",
  "before",
  "brief",
  "build",
  "carousel",
  "carousels",
  "changing",
  "consistent",
  "content",
  "create",
  "creator",
  "creators",
  "design",
  "else",
  "every",
  "explain",
  "for",
  "from",
  "generate",
  "generation",
  "good",
  "have",
  "how",
  "if",
  "into",
  "it",
  "long",
  "make",
  "needs",
  "prompt",
  "reference",
  "regenerate",
  "report",
  "slide",
  "slides",
  "small",
  "source",
  "style",
  "that",
  "the",
  "this",
  "to",
  "trends",
  "uploaded",
  "use",
  "users",
  "using",
  "very",
  "what",
  "with",
  "will",
  "your"
]);

const domainNames = {
  "techcrunch.com": "TechCrunch",
  "pwc.in": "PwC",
  "pwc.com": "PwC"
};

function titleCase(word) {
  if (word === "ai" || word === "ais") return "AI";
  if (/^\d/.test(word)) return word.toUpperCase();
  return word[0].toUpperCase() + word.slice(1);
}

function uniqueUsefulWords(text, limit = 4) {
  const seen = new Set();
  return String(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length > 1 && !stopwords.has(word))
    .filter((word) => {
      if (seen.has(word)) return false;
      seen.add(word);
      return true;
    })
    .slice(0, limit)
    .map(titleCase);
}

function summarizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.replace(/^www\./, "");
    const brand = domainNames[hostname] || titleCase(hostname.split(".")[0]);
    const segments = url.pathname.split("/").filter(Boolean).reverse();
    const slug = segments.find((segment) => /[a-z]/i.test(segment) && !/^\d{4}$/.test(segment)) || "";
    const words = uniqueUsefulWords(slug.replace(/-/g, " "), 5);
    if (!words.length) return brand;
    const withoutBrand = words.filter((word) => word.toLowerCase() !== brand.toLowerCase());
    return [brand, ...withoutBrand].slice(0, 6).join(" ");
  } catch {
    return "";
  }
}

export function summarizePrompt(prompt = "") {
  const text = String(prompt);
  const url = text.match(/https?:\/\/\S+/)?.[0];
  const fromUrl = url ? summarizeUrl(url) : "";
  if (fromUrl) return fromUrl;
  const words = uniqueUsefulWords(text, 4);
  if (!words.length) return "Untitled idea";
  return words.join(" · ");
}
