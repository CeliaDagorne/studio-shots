import type { LumaGenerationSnapshot } from "@/lib/luma";

/** Shared snapshot shape returned by every image-generation provider. */
export type ImageGenerationSnapshot = LumaGenerationSnapshot;

export type ImageGenerationProviderName = "luma" | "fake";

export type CreateGenerationParams = {
  prompt: string;
  photoUrl: string;
  candidateId: string;
  candidateIndex: number;
};

export type StoreCandidateImageParams = {
  sourceUrl: string;
  sku: string;
  candidateId: string;
};

/**
 * Provider contract for paid Luma generation and the local/preview fake path.
 * Fake implementations must never construct a Luma client or call Luma endpoints.
 */
export type ImageGenerationProvider = {
  readonly name: ImageGenerationProviderName;
  createGeneration: (params: CreateGenerationParams) => Promise<ImageGenerationSnapshot>;
  pollUntilDone: (generationId: string) => Promise<ImageGenerationSnapshot>;
  storeCandidateImage: (
    params: StoreCandidateImageParams,
  ) => Promise<{ blobPath: string; blobUrl: string }>;
};

export type ResolveImageGenerationProviderParams = {
  provider?: string | null;
  vercelEnv?: string | null;
};

/**
 * Select the active image-generation provider.
 * - Explicit `luma` / `fake` always win (fake is refused in Vercel production).
 * - Unset defaults to `luma` only when `VERCEL_ENV=production`.
 * - Unset defaults to `fake` for local and Preview so workflows can be tested without spend.
 */
export const resolveImageGenerationProviderName = (
  params: ResolveImageGenerationProviderParams = {},
): ImageGenerationProviderName => {
  const raw = (params.provider ?? process.env.IMAGE_GENERATION_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  const vercelEnv = (params.vercelEnv ?? process.env.VERCEL_ENV ?? "").trim();

  if (raw === "fake") {
    if (vercelEnv === "production") {
      throw new Error(
        'IMAGE_GENERATION_PROVIDER=fake is refused when VERCEL_ENV=production. Set IMAGE_GENERATION_PROVIDER=luma.',
      );
    }
    return "fake";
  }

  if (raw === "luma") {
    return "luma";
  }

  if (raw === "") {
    return vercelEnv === "production" ? "luma" : "fake";
  }

  throw new Error(
    `Invalid IMAGE_GENERATION_PROVIDER="${raw}". Use "luma" or "fake".`,
  );
};

export const SLACK_FAKE_GENERATION_CONTEXT =
  "🧪 Test mode · Free — no Luma calls or generation charges.";

/** Compact notice on candidate / continuation messages in fake mode. */
export const SLACK_FAKE_CANDIDATE_CONTEXT = "🧪 Test candidate · No generation cost";

export const isFakeImageGenerationProvider = (
  name: ImageGenerationProviderName = resolveImageGenerationProviderName(),
): boolean => name === "fake";

let loggedProvider: ImageGenerationProviderName | null = null;

/** Log the active provider once per process without credentials. */
export const logActiveImageGenerationProvider = (
  name: ImageGenerationProviderName = resolveImageGenerationProviderName(),
): void => {
  if (loggedProvider === name) {
    return;
  }
  loggedProvider = name;
  console.info(`[image-generation] provider=${name}`);
};

/** Test helper: allow re-logging after env changes in unit tests. */
export const resetImageGenerationProviderLogForTests = (): void => {
  loggedProvider = null;
};
