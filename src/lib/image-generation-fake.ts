import { createHash } from "node:crypto";

import { candidateBlobPath } from "@/lib/blob";
import type {
  CreateGenerationParams,
  ImageGenerationProvider,
  ImageGenerationSnapshot,
  StoreCandidateImageParams,
} from "@/lib/image-generation";

/**
 * Historical demo packshot paths (one per catalog SKU).
 * Fake generation no longer cycles these — it reuses the request's own source photoUrl.
 */
export const FAKE_CANDIDATE_DEMO_PATHS = [
  "/demo/ss-001-lilac-vase.png",
  "/demo/ss-002-amber-candle.png",
  "/demo/ss-003-olive-weekend-bag.png",
] as const;

export type FakeGenerationProviderOptions = {
  appUrl: string;
  /** Simulated generate/poll delay so Slack loading states remain testable. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const fakeGenerationId = (candidateId: string): string => {
  const digest = createHash("sha256").update(`fake-gen:${candidateId}`).digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
};

/**
 * Resolve the output image for a fake candidate.
 * Always the product's own source photo — never another SKU's demo asset.
 */
export const fakeCandidateOutputUrl = (photoUrl: string): string => photoUrl.trim();

type FakeJob = {
  candidateId: string;
  candidateIndex: number;
  outputUrl: string;
};

/**
 * Local / Preview provider: never constructs a Luma client or calls Luma.
 * Reuses the catalog source photo for every candidate so SKUs cannot cross-contaminate.
 */
export const createFakeGenerationProvider = (
  options: FakeGenerationProviderOptions,
): ImageGenerationProvider => {
  const delayMs = options.delayMs ?? 400;
  const sleep = options.sleep ?? defaultSleep;
  const jobs = new Map<string, FakeJob>();

  return {
    name: "fake",
    createGeneration: async (
      params: CreateGenerationParams,
    ): Promise<ImageGenerationSnapshot> => {
      await sleep(delayMs);
      const id = fakeGenerationId(params.candidateId);
      const outputUrl = fakeCandidateOutputUrl(params.photoUrl);
      if (!outputUrl) {
        return {
          id,
          state: "failed",
          outputUrl: null,
          failureReason: "Fake generation requires a product source photoUrl",
        };
      }
      jobs.set(id, {
        candidateId: params.candidateId,
        candidateIndex: params.candidateIndex,
        outputUrl,
      });
      return {
        id,
        state: "queued",
        outputUrl: null,
        failureReason: null,
      };
    },
    pollUntilDone: async (generationId: string): Promise<ImageGenerationSnapshot> => {
      await sleep(delayMs);
      const job = jobs.get(generationId);
      if (!job) {
        return {
          id: generationId,
          state: "failed",
          outputUrl: null,
          failureReason: `Unknown fake generation id: ${generationId}`,
        };
      }
      return {
        id: generationId,
        state: "completed",
        outputUrl: job.outputUrl,
        failureReason: null,
      };
    },
    storeCandidateImage: async (params: StoreCandidateImageParams) => {
      // Skip Vercel Blob in fake mode; Slack/product pages use the source URL.
      return {
        blobPath: candidateBlobPath(params.sku, params.candidateId),
        blobUrl: params.sourceUrl,
      };
    },
  };
};
