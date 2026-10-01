import { downloadAndStoreCandidateImage } from "@/lib/blob";
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

/**
 * Production provider: Luma Agents `image_edit` + Blob persistence.
 * Instantiates the Luma client only when a generation is created.
 */
export const createLumaGenerationProvider = (): ImageGenerationProvider => ({
  name: "luma",
  createGeneration: async (
    params: CreateGenerationParams,
  ): Promise<LumaGenerationSnapshot> =>
    createImageEditGeneration({
      prompt: params.prompt,
      photoUrl: params.photoUrl,
    }),
  pollUntilDone: pollGenerationUntilDone,
  storeCandidateImage: (params: StoreCandidateImageParams) =>
    downloadAndStoreCandidateImage(params),
});
