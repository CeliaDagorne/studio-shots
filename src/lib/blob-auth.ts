export type BlobAuthMode = "oidc" | "rw_token";

export type BlobAuthStatus =
  | { ok: true; mode: BlobAuthMode }
  | { ok: false; message: string };

/** Subset of `@vercel/blob` command auth options used by put/head. */
export type BlobAuthCommandOptions = {
  token?: string;
  oidcToken?: string;
  storeId?: string;
};

const trimEnv = (value: string | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

/**
 * Resolve Blob SDK auth options for the current runtime.
 * Preferred: VERCEL_OIDC_TOKEN + BLOB_STORE_ID (current Vercel Blob OIDC flow).
 * Fallback: BLOB_READ_WRITE_TOKEN for legacy / external runtimes.
 */
export const getBlobAuthStatus = (): BlobAuthStatus => {
  const oidcToken = trimEnv(process.env.VERCEL_OIDC_TOKEN);
  const storeId = trimEnv(process.env.BLOB_STORE_ID);
  const rwToken = trimEnv(process.env.BLOB_READ_WRITE_TOKEN);

  if (oidcToken && storeId) {
    return { ok: true, mode: "oidc" };
  }
  if (rwToken) {
    return { ok: true, mode: "rw_token" };
  }

  const missing: string[] = [];
  if (!oidcToken && !rwToken) {
    missing.push("VERCEL_OIDC_TOKEN (with BLOB_STORE_ID) or BLOB_READ_WRITE_TOKEN");
  } else if (oidcToken && !storeId) {
    missing.push("BLOB_STORE_ID (required with VERCEL_OIDC_TOKEN)");
  } else if (storeId && !oidcToken && !rwToken) {
    missing.push("VERCEL_OIDC_TOKEN or BLOB_READ_WRITE_TOKEN");
  }

  return {
    ok: false,
    message:
      `Vercel Blob credentials are not configured for this runtime. Missing: ${missing.join("; ")}. ` +
      `For local/dev with the connected store, run \`vercel env pull\` (or \`vercel dev\`) so ` +
      `VERCEL_OIDC_TOKEN and BLOB_STORE_ID are available. ` +
      `BLOB_READ_WRITE_TOKEN remains supported as a legacy/external-runtime fallback.`,
  };
};

/** Throw a clear, non-secret error when Blob auth cannot be established. */
export const assertBlobAuthConfigured = (): BlobAuthMode => {
  const status = getBlobAuthStatus();
  if (!status.ok) {
    throw new Error(status.message);
  }
  return status.mode;
};

/**
 * Options to pass into `@vercel/blob` put/head/del.
 * Prefer explicit OIDC + storeId; otherwise pass rw token; otherwise rely on SDK env defaults.
 */
export const getBlobCommandOptions = (): BlobAuthCommandOptions => {
  assertBlobAuthConfigured();
  const oidcToken = trimEnv(process.env.VERCEL_OIDC_TOKEN);
  const storeId = trimEnv(process.env.BLOB_STORE_ID);
  const rwToken = trimEnv(process.env.BLOB_READ_WRITE_TOKEN);

  if (oidcToken && storeId) {
    return { oidcToken, storeId };
  }
  return { token: rwToken };
};
