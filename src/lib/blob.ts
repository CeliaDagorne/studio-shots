import { put } from "@vercel/blob";

import { getBlobCommandOptions } from "@/lib/blob-auth";

export const candidateBlobPath = (sku: string, candidateId: string): string =>
  `candidates/${sku}/${candidateId}.jpg`;

const downloadBytes = async (sourceUrl: string): Promise<Buffer> => {
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to download Luma output: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

export const downloadAndStoreCandidateImage = async (params: {
  sourceUrl: string;
  sku: string;
  candidateId: string;
}): Promise<{ blobPath: string; blobUrl: string }> => {
  const blobPath = candidateBlobPath(params.sku, params.candidateId);
  let lastError: unknown;
  const auth = getBlobCommandOptions();

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const bytes = await downloadBytes(params.sourceUrl);
      // Prefer OIDC (VERCEL_OIDC_TOKEN + BLOB_STORE_ID). RW token is legacy fallback.
      const uploaded = await put(blobPath, bytes, {
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: false,
        allowOverwrite: true,
        ...auth,
      });
      return {
        blobPath,
        blobUrl: uploaded.url,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Blob upload failed after retry");
};
