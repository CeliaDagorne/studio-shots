import sharp from "sharp";

import {
  type OutputAspectRatio,
  outputAspectRatioParts,
} from "@/lib/output-format";

/** Long-edge pixels for normalized Luma sources / fake outputs. */
export const NORMALIZED_SOURCE_LONG_EDGE = 2048;

/** Inset fraction so the product keeps a clear margin inside the canvas. */
export const NORMALIZED_SAFE_MARGIN = 0.06;

export type NormalizedImage = {
  bytes: Buffer;
  contentType: "image/jpeg";
  width: number;
  height: number;
};

const canvasSizeForRatio = (
  ratio: OutputAspectRatio,
): { width: number; height: number } => {
  const { width: rw, height: rh } = outputAspectRatioParts(ratio);
  if (rw >= rh) {
    const width = NORMALIZED_SOURCE_LONG_EDGE;
    const height = Math.max(1, Math.round((width * rh) / rw));
    return { width, height };
  }
  const height = NORMALIZED_SOURCE_LONG_EDGE;
  const width = Math.max(1, Math.round((height * rw) / rh));
  return { width, height };
};

/**
 * Letterbox the source onto a canvas matching `aspectRatio`.
 * Contain (never crop/stretch) with safe margins and a neutral pad.
 */
export const normalizeImageToAspectRatio = async (params: {
  bytes: Buffer;
  aspectRatio: OutputAspectRatio;
}): Promise<NormalizedImage> => {
  const canvas = canvasSizeForRatio(params.aspectRatio);
  const marginX = Math.round(canvas.width * NORMALIZED_SAFE_MARGIN);
  const marginY = Math.round(canvas.height * NORMALIZED_SAFE_MARGIN);
  const innerWidth = Math.max(1, canvas.width - marginX * 2);
  const innerHeight = Math.max(1, canvas.height - marginY * 2);

  const fitted = await sharp(params.bytes, { failOn: "none" })
    .rotate()
    .resize({
      width: innerWidth,
      height: innerHeight,
      fit: "inside",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = Math.floor((canvas.width - fitted.info.width) / 2);
  const top = Math.floor((canvas.height - fitted.info.height) / 2);

  const composed = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  })
    .composite([{ input: fitted.data, left, top }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    bytes: composed.data,
    contentType: "image/jpeg",
    width: composed.info.width,
    height: composed.info.height,
  };
};

export const readImageDimensions = async (
  bytes: Buffer,
): Promise<{ width: number; height: number } | null> => {
  try {
    const meta = await sharp(bytes, { failOn: "none" }).metadata();
    if (!meta.width || !meta.height) return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
};

export const fetchImageDimensions = async (
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ width: number; height: number } | null> => {
  try {
    const response = await fetchImpl(url, { cache: "no-store", redirect: "follow" });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return readImageDimensions(bytes);
  } catch {
    return null;
  }
};
