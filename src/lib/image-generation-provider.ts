import { env } from "@/lib/env";
import {
  logActiveImageGenerationProvider,
  resolveImageGenerationProviderName,
  type ImageGenerationProvider,
} from "@/lib/image-generation";
import { createFakeGenerationProvider } from "@/lib/image-generation-fake";
import { createLumaGenerationProvider } from "@/lib/image-generation-luma";

let cachedProvider: ImageGenerationProvider | null = null;
let cachedName: string | null = null;

/**
 * Resolve and cache the configured image-generation provider.
 * Logs the active provider name without credentials.
 */
export const getImageGenerationProvider = (): ImageGenerationProvider => {
  const name = resolveImageGenerationProviderName();
  if (cachedProvider && cachedName === name) {
    return cachedProvider;
  }

  logActiveImageGenerationProvider(name);

  cachedProvider =
    name === "fake"
      ? createFakeGenerationProvider({ appUrl: env.appUrl })
      : createLumaGenerationProvider();
  cachedName = name;
  return cachedProvider;
};

/** Test helper: clear the cached provider after env changes. */
export const resetImageGenerationProviderForTests = (): void => {
  cachedProvider = null;
  cachedName = null;
};
