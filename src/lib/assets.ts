/**
 * Resolve catalog photo paths for storage/display and for external APIs (e.g. Luma).
 * Absolute http(s) URLs are kept as-is. Root-relative paths (/demo/...) are joined to APP_URL.
 */
export const resolvePublicAssetUrl = (photoUrl: string, appUrl: string): string => {
  const trimmed = photoUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const base = appUrl.replace(/\/+$/, "");
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${base}${path}`;
};
