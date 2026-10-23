export function normalizeMailLink(value: string): string | null {
  let candidate = value.trim();
  if (
    !candidate ||
    Array.from(candidate).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return null;
  if (!/^[a-z][a-z\d+.-]*:/i.test(candidate))
    candidate = "https://" + candidate;
  try {
    const url = new URL(candidate);
    if (!["https:", "http:", "mailto:"].includes(url.protocol)) return null;
    if (url.protocol === "mailto:" && !url.pathname.includes("@")) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
