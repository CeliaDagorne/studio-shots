import type { LumaGenerationSnapshot } from "@/lib/luma";

export type CandidatePipelineDeps = {
  createImageRefGeneration: (params: {
    prompt: string;
    photoUrl: string;
  }) => Promise<LumaGenerationSnapshot>;
  pollGenerationUntilDone: (generationId: string) => Promise<LumaGenerationSnapshot>;
  downloadAndStoreCandidateImage: (params: {
    sourceUrl: string;
    sku: string;
    candidateId: string;
  }) => Promise<{ blobPath: string; blobUrl: string }>;
};

export type CandidatePipelineResult =
  | {
      status: "ready";
      lumaGenerationId: string;
      lumaState: string;
      blobPath: string;
      blobUrl: string;
    }
  | {
      status: "failed";
      lumaGenerationId?: string;
      lumaState?: string;
      errorMessage: string;
    };

/** Pure create → poll → blob flow. Inject mocks in tests; no paid calls unless deps are live. */
export const runCandidateImagePipeline = async (
  deps: CandidatePipelineDeps,
  params: {
    candidateId: string;
    productSku: string;
    photoUrl: string;
    prompt: string;
  },
): Promise<CandidatePipelineResult> => {
  try {
    const created = await deps.createImageRefGeneration({
      prompt: params.prompt,
      photoUrl: params.photoUrl,
    });

    const finished = await deps.pollGenerationUntilDone(created.id);
    if (finished.state !== "completed" || !finished.outputUrl) {
      return {
        status: "failed",
        lumaGenerationId: created.id,
        lumaState: finished.state,
        errorMessage: finished.failureReason ?? "Luma generation failed",
      };
    }

    const stored = await deps.downloadAndStoreCandidateImage({
      sourceUrl: finished.outputUrl,
      sku: params.productSku,
      candidateId: params.candidateId,
    });

    return {
      status: "ready",
      lumaGenerationId: created.id,
      lumaState: finished.state,
      blobPath: stored.blobPath,
      blobUrl: stored.blobUrl,
    };
  } catch (error) {
    return {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown candidate failure",
    };
  }
};
