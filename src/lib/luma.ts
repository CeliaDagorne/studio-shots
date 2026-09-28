import Luma from "luma-agents";

import { env } from "@/lib/env";
import { MVP_ASPECT_RATIO } from "@/lib/request-planning";

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

export const buildImageRefPrompt = (params: {
  productName: string;
  colorOrFinish: string;
  material: string;
  shotIdea: string;
}): string =>
  [
    params.shotIdea.trim(),
    `Preserve the exact ${params.colorOrFinish.toLowerCase()} ${params.material.toLowerCase()} ${params.productName.toLowerCase()}'s shape, color, proportions, and surface details.`,
    "Natural lifestyle product photography, softly styled and not overly staged.",
  ].join(" ");

export const createImageRefGeneration = async (params: {
  prompt: string;
  photoUrl: string;
}): Promise<LumaGenerationSnapshot> => {
  const generation = await getClient().generations.create({
    prompt: params.prompt,
    model: "uni-1",
    image_ref: [{ url: params.photoUrl }],
    aspect_ratio: MVP_ASPECT_RATIO,
    output_format: "jpeg",
  });

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
