import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { head, put, BlobNotFoundError } from "@vercel/blob";

import { resolvePublicAssetUrl } from "@/lib/assets";
import { assertBlobAuthConfigured, getBlobCommandOptions } from "@/lib/blob-auth";
import { normalizeImageToAspectRatio } from "@/lib/image-normalize";
import {
  DEFAULT_OUTPUT_ASPECT_RATIO,
  type OutputAspectRatio,
  parseOutputAspectRatio,
} from "@/lib/output-format";

/** Hosts that must never be sent to Luma as image sources. */
export const isUnstableLumaSourceHostname = (hostname: string): boolean => {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  if (
    host.endsWith(".ngrok-free.app") ||
    host.endsWith(".ngrok-free.dev") ||
    host.endsWith(".ngrok.io") ||
    host.endsWith(".ngrok.app") ||
    host === "ngrok.io"
  ) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
};

export const isRelativeAssetPath = (photoUrl: string): boolean => {
  const trimmed = photoUrl.trim();
  return Boolean(trimmed) && !/^https?:\/\//i.test(trimmed);
};

/** True when Luma must not receive this URL as source.url. */
export const needsLumaSourceMaterialization = (
  photoUrl: string,
  appUrl: string,
): boolean => {
  if (isRelativeAssetPath(photoUrl)) return true;
  try {
    const absolute = resolvePublicAssetUrl(photoUrl, appUrl);
    const parsed = new URL(absolute);
    if (parsed.protocol !== "https:") return true;
    return isUnstableLumaSourceHostname(parsed.hostname);
  } catch {
    return true;
  }
};

const extensionForContentType = (contentType: string, fallbackPath: string): string => {
  const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  const fromPath = extname(fallbackPath).replace(/^\./, "").toLowerCase();
  if (fromPath === "jpeg") return "jpg";
  if (fromPath) return fromPath;
  return "png";
};

const contentTypeFromPath = (pathname: string): string => {
  const ext = extname(pathname).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
};

/** Deterministic Blob pathname for a normalized catalog source. */
export const lumaSourceBlobPath = (params: {
  sku: string;
  sourceKey: string;
  aspectRatio: OutputAspectRatio;
  extension: string;
}): string => {
  const digest = createHash("sha256")
    .update(`${params.sku}\0${params.sourceKey}\0${params.aspectRatio}`)
    .digest("hex")
    .slice(0, 24);
  const safeSku = params.sku.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeRatio = params.aspectRatio.replace(":", "x");
  const ext = params.extension.replace(/^\./, "").toLowerCase() || "jpg";
  return `luma-sources/${safeSku}/${safeRatio}-${digest}.${ext}`;
};

const assetPathnameFromPhotoUrl = (photoUrl: string, appUrl: string): string | null => {
  const trimmed = photoUrl.trim();
  if (!trimmed) return null;
  if (isRelativeAssetPath(trimmed)) {
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }
  try {
    return new URL(resolvePublicAssetUrl(trimmed, appUrl)).pathname;
  } catch {
    return null;
  }
};

export type LumaSourceBytes = {
  bytes: Buffer;
  contentType: string;
};

export type ResolveStableLumaSourceDeps = {
  readPublicFile?: (pathname: string) => Promise<Buffer | null>;
  fetchImpl?: typeof fetch;
  headBlob?: (
    pathname: string,
  ) => Promise<{ url: string; contentType: string } | null>;
  putBlob?: (
    pathname: string,
    bytes: Buffer,
    contentType: string,
  ) => Promise<{ url: string }>;
  nowValidateImageUrl?: (url: string) => Promise<void>;
  normalizeImage?: typeof normalizeImageToAspectRatio;
};

const defaultReadPublicFile = async (pathname: string): Promise<Buffer | null> => {
  if (!pathname.startsWith("/") || pathname.includes("..")) {
    return null;
  }
  const localPath = join(process.cwd(), "public", pathname.slice(1));
  try {
    return await readFile(localPath);
  } catch {
    return null;
  }
};

const defaultHeadBlob = async (
  pathname: string,
): Promise<{ url: string; contentType: string } | null> => {
  try {
    const result = await head(pathname, getBlobCommandOptions());
    return { url: result.url, contentType: result.contentType };
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      return null;
    }
    throw error;
  }
};

const defaultPutBlob = async (
  pathname: string,
  bytes: Buffer,
  contentType: string,
): Promise<{ url: string }> => {
  const uploaded = await put(pathname, bytes, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    ...getBlobCommandOptions(),
  });
  return { url: uploaded.url };
};

/**
 * Fail closed before any Luma create: URL must be HTTPS and Content-Type image/*.
 */
export const assertLumaSourceImageUrl = async (
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `Luma source URL is invalid. Provide a public HTTPS image URL (got "${url}").`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Luma source URL must be HTTPS (got ${parsed.protocol}//${parsed.hostname}). ` +
        `Localhost and ngrok URLs are not accepted.`,
    );
  }
  if (isUnstableLumaSourceHostname(parsed.hostname)) {
    throw new Error(
      `Luma source URL host "${parsed.hostname}" is not stable. ` +
        `Upload the catalog photo to Blob/CDN and use that public HTTPS image URL.`,
    );
  }

  let response = await fetchImpl(url, { method: "HEAD", cache: "no-store", redirect: "follow" });
  if (response.status === 405 || response.status === 501) {
    response = await fetchImpl(url, { method: "GET", cache: "no-store", redirect: "follow" });
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    throw new Error(
      `Luma source URL returned HTTP ${response.status}. ` +
        `Fix the public image URL before generating (Content-Type was "${contentType || "unknown"}").`,
    );
  }
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(
      `Luma source URL must return Content-Type image/* before create. ` +
        `Got "${contentType || "unknown"}" from ${parsed.origin}${parsed.pathname}. ` +
        `Ngrok HTML interstitials and other non-image responses are rejected.`,
    );
  }
};

const loadSourceBytes = async (
  catalogPhotoUrl: string,
  appUrl: string,
  deps: ResolveStableLumaSourceDeps,
): Promise<LumaSourceBytes> => {
  const readPublicFile = deps.readPublicFile ?? defaultReadPublicFile;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const pathname = assetPathnameFromPhotoUrl(catalogPhotoUrl, appUrl);

  if (pathname) {
    const fromDisk = await readPublicFile(pathname);
    if (fromDisk) {
      return {
        bytes: fromDisk,
        contentType: contentTypeFromPath(pathname),
      };
    }
  }

  const absolute = resolvePublicAssetUrl(catalogPhotoUrl, appUrl);
  const headers: Record<string, string> = {};
  try {
    const host = new URL(absolute).hostname.toLowerCase();
    if (host.includes("ngrok")) {
      // Server-side fetch only — never relied on by Luma itself.
      headers["ngrok-skip-browser-warning"] = "true";
    }
  } catch {
    // ignore
  }

  const response = await fetchImpl(absolute, {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
    headers,
  });
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (!response.ok) {
    throw new Error(
      `Failed to download catalog source for Luma materialization: HTTP ${response.status} ` +
        `(Content-Type "${contentType}").`,
    );
  }
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(
      `Catalog source resolved to non-image Content-Type "${contentType}" while materializing for Luma. ` +
        `Ensure the demo asset is reachable as image/* (ngrok HTML interstitials are not valid sources).`,
    );
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: contentType.split(";")[0]?.trim() || contentType,
  };
};

const inflightByPath = new Map<string, Promise<string>>();

/**
 * Resolve a catalog photo into a stable public HTTPS image URL for Luma/fake generation.
 * Always letterboxes onto the campaign aspect ratio, uploads once to a deterministic Blob
 * path (SKU + source + ratio), and reuses that object on later attempts.
 * Does not mutate the catalog photo URL used by the website.
 */
export const resolveStableLumaSourceUrl = async (params: {
  catalogPhotoUrl: string;
  appUrl: string;
  sku: string;
  aspectRatio?: OutputAspectRatio | string;
  deps?: ResolveStableLumaSourceDeps;
}): Promise<string> => {
  const deps = params.deps ?? {};
  const aspectRatio = parseOutputAspectRatio(
    params.aspectRatio,
    DEFAULT_OUTPUT_ASPECT_RATIO,
  );
  const validate = async (url: string): Promise<void> => {
    if (deps.nowValidateImageUrl) {
      await deps.nowValidateImageUrl(url);
      return;
    }
    await assertLumaSourceImageUrl(url, deps.fetchImpl ?? fetch);
  };
  const catalogPhotoUrl = params.catalogPhotoUrl.trim();
  if (!catalogPhotoUrl) {
    throw new Error("Catalog photo URL is required before calling Luma.");
  }

  // Materialization requires Blob auth (OIDC+store id, or legacy RW token).
  // Skip when tests inject put/head deps.
  if (!deps.putBlob || !deps.headBlob) {
    assertBlobAuthConfigured();
  }

  const sourceKey = isRelativeAssetPath(catalogPhotoUrl)
    ? catalogPhotoUrl.startsWith("/")
      ? catalogPhotoUrl
      : `/${catalogPhotoUrl}`
    : catalogPhotoUrl;

  const pathname = lumaSourceBlobPath({
    sku: params.sku,
    sourceKey,
    aspectRatio,
    extension: "jpg",
  });

  const existingInflight = inflightByPath.get(pathname);
  if (existingInflight) {
    return existingInflight;
  }

  const work = (async () => {
    const headBlob = deps.headBlob ?? defaultHeadBlob;
    const putBlob = deps.putBlob ?? defaultPutBlob;
    const normalize = deps.normalizeImage ?? normalizeImageToAspectRatio;

    const existing = await headBlob(pathname);
    if (existing?.url && existing.contentType.toLowerCase().startsWith("image/")) {
      await validate(existing.url);
      return existing.url;
    }

    const loaded = await loadSourceBytes(catalogPhotoUrl, params.appUrl, deps);
    const normalized = await normalize({
      bytes: loaded.bytes,
      aspectRatio,
    });
    const uploaded = await putBlob(pathname, normalized.bytes, normalized.contentType);
    await validate(uploaded.url);
    return uploaded.url;
  })();

  inflightByPath.set(pathname, work);
  try {
    return await work;
  } finally {
    inflightByPath.delete(pathname);
  }
};

/** Test helper to clear in-flight dedupe between cases. */
export const resetLumaSourceInflightForTests = (): void => {
  inflightByPath.clear();
};
