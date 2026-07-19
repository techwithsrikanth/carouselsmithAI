export function normalizeInstagramHandle(handle = "") {
  const compact = String(handle)
    .trim()
    .replace(/\s+/g, "")
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "");
  const clean = compact.replace(/[/?#].*$/, "").replace(/^@+/, "");
  return clean ? `@${clean}` : "";
}
