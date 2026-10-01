import Luma from "luma-agents";

import { env } from "@/lib/env";

export type LumaGenerationSnapshot = {
  id: string;
  state: string;
  outputUrl: string | null;
  failureReason: string | null;
};

let client: Luma | null = null;

const getClient = () => {
  if (!client) {
    client = new Luma({ authToken: env.lumaAgentsApiKey });
  }
  return client;
};

/**
 * Fixed product-photography constraints appended to every catalog Shot Idea.
 * These keep the full product recognizable when editing the source packshot.
 */
export const PRODUCT_PHOTOGRAPHY_CONSTRAINTS = [
  "Preserve the exact product from the source image, including its shape, proportions, color, material and distinctive details.",
  "Keep the complete product visible inside the frame.",
  "Center the product and make it occupy approximately 60–75% of the image.",
  "Leave a clear safe margin around every edge.",
  "Do not crop, obscure, redesign or replace any part of the product.",
  "Build the requested lifestyle environment around the product.",
  "Avoid large empty areas and plain white backgrounds.",
  "Props may support the scene but must never cover the product.",
].join("\n");

/** Build the final image-edit prompt from the catalog Shot Idea + framing rules. */
export const buildImageEditPrompt = (params: { shotIdea: string }): string => {
  const idea = params.shotIdea.trim();
  if (!idea) {
    return PRODUCT_PHOTOGRAPHY_CONSTRAINTS;
  }
  return `${idea}\n\n${PRODUCT_PHOTOGRAPHY_CONSTRAINTS}`;
};

/**
 * Exact Luma Agents create payload for product lifestyle edits.
 * `aspect_ratio` is intentionally omitted: Luma ignores it for `image_edit`
 * and derives output dimensions from the source catalog photo.
 * Never falls back to `image_ref`.
 */
export const buildImageEditCreateParams = (params: {
  prompt: string;
  photoUrl: string;
}): Luma.GenerationCreateParams => ({
  type: "image_edit",
  prompt: params.prompt,
  model: "uni-1",
  source: { url: params.photoUrl },
  output_format: "jpeg",
});

export const createImageEditGeneration = async (params: {
  prompt: string;
  photoUrl: string;
}): Promise<LumaGenerationSnapshot> => {
  const generation = await getClient().generations.create(
    buildImageEditCreateParams(params),
  );

  return {
    id: generation.id,
    state: generation.state,
    outputUrl: generation.output?.[0]?.url ?? null,
    failureReason: generation.failure_reason ?? null,
  };
};

export const getGeneration = async (generationId: string): Promise<LumaGenerationSnapshot> => {
  const generation = await getClient().generations.get(generationId);
  return {
    id: generation.id,
    state: generation.state,
    outputUrl: generation.output?.[0]?.url ?? null,
    failureReason: generation.failure_reason ?? null,
  };
};

export const pollGenerationUntilDone = async (
  generationId: string,
  options?: { timeoutMs?: number; initialWaitMs?: number; pollIntervalMs?: number },
): Promise<LumaGenerationSnapshot> => {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const initialWaitMs = options?.initialWaitMs ?? 20_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  await new Promise((resolve) => setTimeout(resolve, initialWaitMs));

  while (true) {
    const snapshot = await getGeneration(generationId);
    if (snapshot.state === "completed" || snapshot.state === "failed") {
      return snapshot;
    }
    if (Date.now() > deadline) {
      throw new Error(`Generation ${generationId} timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
};
