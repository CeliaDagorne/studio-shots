import { createHash } from "node:crypto";

import { resolvePublicAssetUrl } from "@/lib/assets";
import { candidateBlobPath } from "@/lib/blob";
import type {
  CreateGenerationParams,
  ImageGenerationProvider,
  ImageGenerationSnapshot,
  StoreCandidateImageParams,
} from "@/lib/image-generation";

/** Publishable demo packshots used as deterministic fake candidates. */
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

export const fakeCandidateDemoPath = (candidateIndex: number): string => {
  const index = Math.max(1, candidateIndex) - 1;
  return FAKE_CANDIDATE_DEMO_PATHS[index % FAKE_CANDIDATE_DEMO_PATHS.length]!;
};

type FakeJob = {
  candidateId: string;
  candidateIndex: number;
  outputUrl: string;
};

/**
 * Local / Preview provider: never constructs a Luma client or calls Luma.
 * Returns deterministic demo image URLs through the normal candidate result shape.
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
      const demoPath = fakeCandidateDemoPath(params.candidateIndex);
      const outputUrl = resolvePublicAssetUrl(demoPath, options.appUrl);
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
      // Skip Vercel Blob in fake mode; Slack/product pages use public demo URLs.
      return {
        blobPath: candidateBlobPath(params.sku, params.candidateId),
        blobUrl: params.sourceUrl,
      };
    },
  };
};
