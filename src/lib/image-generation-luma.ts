import { downloadAndStoreCandidateImage } from "@/lib/blob";
import { env } from "@/lib/env";
import type {
  CreateGenerationParams,
  ImageGenerationProvider,
  StoreCandidateImageParams,
} from "@/lib/image-generation";
import {
  createImageEditGeneration,
  pollGenerationUntilDone,
  type LumaGenerationSnapshot,
} from "@/lib/luma";
import {
  assertLumaSourceImageUrl,
  needsLumaSourceMaterialization,
} from "@/lib/luma-source";

/**
 * Production provider: Luma Agents `image_edit` + Blob persistence.
 * Instantiates the Luma client only when a generation is created.
 * Callers must pass a stable public HTTPS image URL (see resolveStableLumaSourceUrl).
 */
export const createLumaGenerationProvider = (): ImageGenerationProvider => ({
  name: "luma",
  createGeneration: async (
    params: CreateGenerationParams,
  ): Promise<LumaGenerationSnapshot> => {
    if (needsLumaSourceMaterialization(params.photoUrl, env.appUrl)) {
      throw new Error(
        `Refusing Luma create with unstable source URL host. ` +
          `Materialize catalog photos to Blob first (got "${params.photoUrl}").`,
      );
    }
    await assertLumaSourceImageUrl(params.photoUrl);
    return createImageEditGeneration({
      prompt: params.prompt,
      photoUrl: params.photoUrl,
    });
  },
  pollUntilDone: pollGenerationUntilDone,
  storeCandidateImage: (params: StoreCandidateImageParams) =>
    downloadAndStoreCandidateImage(params),
});
