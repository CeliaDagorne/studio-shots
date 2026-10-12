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
      /** Luma (or provider) reported a terminal failure. */
      status: "failed";
      lumaGenerationId?: string;
      lumaState?: string;
      errorMessage: string;
    }
  | {
      /** Polling deadline hit; the external job may still be running. */
      status: "timed_out";
      lumaGenerationId: string;
      lumaState?: string;
      errorMessage: string;
    };

export const isPollingTimeoutError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out after \d+ms/i.test(message);
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
  let createdId: string | null = null;

  try {
    const created = await provider.createGeneration({
      prompt: params.prompt,
      photoUrl: params.photoUrl,
      candidateId: params.candidateId,
      candidateIndex: params.candidateIndex,
    });
    createdId = created.id;

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
    const errorMessage =
      error instanceof Error ? error.message : "Unknown candidate failure";

    if (createdId && isPollingTimeoutError(error)) {
      return {
        status: "timed_out",
        lumaGenerationId: createdId,
        errorMessage,
      };
    }

    return {
      status: "failed",
      ...(createdId ? { lumaGenerationId: createdId } : {}),
      errorMessage,
    };
  }
};
