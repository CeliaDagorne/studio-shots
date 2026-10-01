import type { ImageGenerationProvider } from "@/lib/image-generation";

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

/** Pure create → poll → store flow via the active image-generation provider. */
export const runCandidateImagePipeline = async (
  provider: ImageGenerationProvider,
  params: {
    candidateId: string;
    candidateIndex: number;
    productSku: string;
    photoUrl: string;
    prompt: string;
  },
): Promise<CandidatePipelineResult> => {
  try {
    const created = await provider.createGeneration({
      prompt: params.prompt,
      photoUrl: params.photoUrl,
      candidateId: params.candidateId,
      candidateIndex: params.candidateIndex,
    });

    const finished = await provider.pollUntilDone(created.id);
    if (finished.state !== "completed" || !finished.outputUrl) {
      return {
        status: "failed",
        lumaGenerationId: created.id,
        lumaState: finished.state,
        errorMessage: finished.failureReason ?? "Image generation failed",
      };
    }

    const stored = await provider.storeCandidateImage({
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
