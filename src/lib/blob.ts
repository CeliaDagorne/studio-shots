import { put } from "@vercel/blob";

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

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const bytes = await downloadBytes(params.sourceUrl);
      // On Vercel, @vercel/blob authenticates via OIDC to the connected store.
      // Do not pass a long-lived BLOB_READ_WRITE_TOKEN.
      const uploaded = await put(blobPath, bytes, {
        access: "public",
        contentType: "image/jpeg",
        addRandomSuffix: false,
        allowOverwrite: true,
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
