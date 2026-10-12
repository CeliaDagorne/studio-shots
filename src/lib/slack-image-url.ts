import { resolvePublicAssetUrl } from "@/lib/assets";

/**
 * Hosts Slack's crawler cannot reach (loopback / link-local / common private ranges).
 * Slack image blocks require a public absolute HTTPS URL.
 */
export const isNonPublicHostname = (hostname: string): boolean => {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return true;
  }
  if (host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (host === "169.254.169.254" || /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
};

/** True when Slack can fetch the URL for an image block (public absolute HTTPS). */
export const isSlackAccessibleImageUrl = (url: string): boolean => {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("/") || !/^https:\/\//i.test(trimmed)) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return false;
    if (isNonPublicHostname(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolve a candidate image URL for Slack delivery.
 * Relative paths are joined to APP_URL. Returns null when the result is not
 * a public absolute HTTPS URL (e.g. localhost APP_URL / relative leftovers).
 */
export const resolveSlackImageUrl = (
  blobUrl: string,
  appUrl: string,
): string | null => {
  const absolute = resolvePublicAssetUrl(blobUrl, appUrl);

  if (isSlackAccessibleImageUrl(absolute)) {
    return absolute;
  }

  // Localhost (or http) absolute URLs still carry a usable path — rewrite onto
  // a public APP_URL when the operator has pointed APP_URL at ngrok / HTTPS.
  try {
    const parsed = new URL(absolute);
    if (parsed.protocol === "http:" || isNonPublicHostname(parsed.hostname)) {
      const rewritten = resolvePublicAssetUrl(
        `${parsed.pathname}${parsed.search}`,
        appUrl,
      );
      if (isSlackAccessibleImageUrl(rewritten)) {
        return rewritten;
      }
    }
  } catch {
    // ignore — fall through to null
  }

  return null;
};
