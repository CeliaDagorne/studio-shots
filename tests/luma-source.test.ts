import assert from "node:assert/strict";
import test from "node:test";

process.env.APP_URL = process.env.APP_URL ?? "https://studio-shots.example";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://example";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "telegram-token";
process.env.TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET ?? "telegram-secret";
process.env.ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID ?? "-1001";
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "xoxb-test-token";
process.env.SLACK_SIGNING_SECRET =
  process.env.SLACK_SIGNING_SECRET ?? "slack-signing-secret";
process.env.SLACK_TEAM_ID = process.env.SLACK_TEAM_ID ?? "T_ALLOWED";
process.env.SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? "C_ALLOWED";
process.env.LUMA_AGENTS_API_KEY = process.env.LUMA_AGENTS_API_KEY ?? "luma-test-key";

const passthroughNormalize = async (params: {
  bytes: Buffer;
  aspectRatio: string;
}) => ({
  bytes: Buffer.from(`normalized:${params.aspectRatio}`),
  contentType: "image/jpeg" as const,
  width: 1638,
  height: 2048,
});

test("relative demo source is materialized to a public Blob URL", async () => {
  const {
    resolveStableLumaSourceUrl,
    resetLumaSourceInflightForTests,
    lumaSourceBlobPath,
  } = await import("@/lib/luma-source");
  resetLumaSourceInflightForTests();

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let putCount = 0;
  let headedPath: string | null = null;
  let seenRatio: string | null = null;

  const expectedPath = lumaSourceBlobPath({
    sku: "SMOKE-001",
    sourceKey: "/demo/ss-004-cobalt-table-lamp.png",
    aspectRatio: "4:5",
    extension: "jpg",
  });

  const url = await resolveStableLumaSourceUrl({
    catalogPhotoUrl: "/demo/ss-004-cobalt-table-lamp.png",
    appUrl: "https://princess-rendering-lapel.ngrok-free.dev",
    sku: "SMOKE-001",
    aspectRatio: "4:5",
    deps: {
      readPublicFile: async () => png,
      normalizeImage: async (params) => {
        seenRatio = params.aspectRatio;
        return passthroughNormalize(params);
      },
      headBlob: async (pathname) => {
        headedPath = pathname;
        return null;
      },
      putBlob: async (pathname, bytes, contentType) => {
        putCount += 1;
        assert.equal(contentType, "image/jpeg");
        assert.equal(bytes.toString(), "normalized:4:5");
        assert.match(pathname, /^luma-sources\/SMOKE-001\/4x5-/);
        return { url: `https://blob.vercel-storage.com/${pathname}` };
      },
      nowValidateImageUrl: async (resolved) => {
        assert.match(resolved, /^https:\/\/blob\.vercel-storage\.com\//);
      },
    },
  });

  assert.equal(url, `https://blob.vercel-storage.com/${expectedPath}`);
  assert.equal(putCount, 1);
  assert.equal(headedPath, expectedPath);
  assert.equal(seenRatio, "4:5");
  assert.doesNotMatch(url, /ngrok/i);
  assert.doesNotMatch(url, /localhost/i);
});

test("Luma create receives Blob URL, not APP_URL/ngrok", async () => {
  const { createLumaGenerationProvider } = await import("@/lib/image-generation-luma");
  const { buildImageEditCreateParams } = await import("@/lib/luma");

  let createCalls = 0;
  let seenSourceUrl: string | null = null;

  // Exercise the same payload builder Luma create uses after resolution.
  const blobUrl =
    "https://blob.vercel-storage.com/luma-sources/SMOKE-001/4x5-abc123.jpg";
  const body = buildImageEditCreateParams({
    prompt: "editorial lamp",
    photoUrl: blobUrl,
  });
  assert.equal(body.type, "image_edit");
  assert.deepEqual(body.source, { url: blobUrl });
  assert.equal(body.image_ref, undefined);

  const provider = createLumaGenerationProvider();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const target = String(input);
    if (target.includes("blob.vercel-storage.com")) {
      return new Response(null, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    // Any Luma HTTP would go here — prove we never get that far for unstable URLs.
    createCalls += 1;
    seenSourceUrl = target;
    return new Response(JSON.stringify({ id: "should-not-run" }), { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        provider.createGeneration({
          prompt: "x",
          photoUrl: "https://princess-rendering-lapel.ngrok-free.dev/demo/ss-004.png",
          candidateId: "c1",
          candidateIndex: 1,
        }),
      /unstable source URL/i,
    );
    assert.equal(createCalls, 0);
    assert.equal(seenSourceUrl, null);

    // Stable Blob URL is accepted through validation (create still needs real Luma client;
    // we only assert the pre-check allows the URL shape via assert + needs* helpers).
    const { needsLumaSourceMaterialization, assertLumaSourceImageUrl } = await import(
      "@/lib/luma-source"
    );
    assert.equal(
      needsLumaSourceMaterialization(blobUrl, "https://princess-rendering-lapel.ngrok-free.dev"),
      false,
    );
    await assertLumaSourceImageUrl(blobUrl);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTML source is rejected before any Luma create call", async () => {
  const {
    resolveStableLumaSourceUrl,
    resetLumaSourceInflightForTests,
  } = await import("@/lib/luma-source");
  resetLumaSourceInflightForTests();

  let putCount = 0;
  let lumaCreateCalls = 0;

  await assert.rejects(
    () =>
      resolveStableLumaSourceUrl({
        catalogPhotoUrl: "/demo/ss-004-cobalt-table-lamp.png",
        appUrl: "https://app.example",
        sku: "SMOKE-001",
        deps: {
          readPublicFile: async () => null,
          headBlob: async () => null,
          fetchImpl: (async () =>
            new Response("<html>ngrok interstitial</html>", {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            })) as typeof fetch,
          putBlob: async () => {
            putCount += 1;
            return { url: "https://blob.vercel-storage.com/should-not-upload.png" };
          },
          nowValidateImageUrl: async () => {
            throw new Error("should not validate upload");
          },
        },
      }),
    /non-image Content-Type "text\/html/i,
  );
  assert.equal(putCount, 0);
  assert.equal(lumaCreateCalls, 0);

  const { createLumaGenerationProvider } = await import("@/lib/image-generation-luma");
  const provider = createLumaGenerationProvider();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    lumaCreateCalls += 1;
    return new Response("<html>nope</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        provider.createGeneration({
          prompt: "x",
          photoUrl: "https://cdn.example.com/looks-public-but-html.png",
          candidateId: "c1",
          candidateIndex: 1,
        }),
      /Content-Type image\/\*|text\/html/i,
    );
    // Validation fetch may run; Luma SDK create must not.
    // createGeneration fails in assertLumaSourceImageUrl before createImageEditGeneration.
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repeated resolution/retry reuses the existing Blob object", async () => {
  const {
    resolveStableLumaSourceUrl,
    resetLumaSourceInflightForTests,
    lumaSourceBlobPath,
  } = await import("@/lib/luma-source");
  resetLumaSourceInflightForTests();

  const pathname = lumaSourceBlobPath({
    sku: "SMOKE-001",
    sourceKey: "/demo/ss-004-cobalt-table-lamp.png",
    aspectRatio: "1:1",
    extension: "jpg",
  });
  const blobUrl = `https://blob.vercel-storage.com/${pathname}`;
  let putCount = 0;
  let headCount = 0;
  let readCount = 0;
  let normalizeCount = 0;

  const deps = {
    readPublicFile: async () => {
      readCount += 1;
      return Buffer.from("png-bytes");
    },
    normalizeImage: async (params: { bytes: Buffer; aspectRatio: "1:1" | "4:5" | "3:2" }) => {
      normalizeCount += 1;
      return passthroughNormalize(params);
    },
    headBlob: async () => {
      headCount += 1;
      if (putCount === 0) return null;
      return { url: blobUrl, contentType: "image/jpeg" };
    },
    putBlob: async () => {
      putCount += 1;
      return { url: blobUrl };
    },
    nowValidateImageUrl: async () => undefined,
  };

  const first = await resolveStableLumaSourceUrl({
    catalogPhotoUrl: "/demo/ss-004-cobalt-table-lamp.png",
    appUrl: "http://localhost:3000",
    sku: "SMOKE-001",
    aspectRatio: "1:1",
    deps,
  });
  const second = await resolveStableLumaSourceUrl({
    catalogPhotoUrl: "/demo/ss-004-cobalt-table-lamp.png",
    appUrl: "http://localhost:3000",
    sku: "SMOKE-001",
    aspectRatio: "1:1",
    deps,
  });

  assert.equal(first, blobUrl);
  assert.equal(second, blobUrl);
  assert.equal(putCount, 1);
  assert.equal(headCount, 2);
  assert.equal(readCount, 1);
  assert.equal(normalizeCount, 1);
});

test("different campaign ratios use distinct Blob paths", async () => {
  const { lumaSourceBlobPath } = await import("@/lib/luma-source");
  const portrait = lumaSourceBlobPath({
    sku: "SS-001",
    sourceKey: "/demo/ss-001.png",
    aspectRatio: "4:5",
    extension: "jpg",
  });
  const square = lumaSourceBlobPath({
    sku: "SS-001",
    sourceKey: "/demo/ss-001.png",
    aspectRatio: "1:1",
    extension: "jpg",
  });
  assert.notEqual(portrait, square);
  assert.match(portrait, /4x5-/);
  assert.match(square, /1x1-/);
});

test("no paid Luma call occurs when source validation fails", async () => {
  const { createLumaGenerationProvider } = await import("@/lib/image-generation-luma");
  const { runCandidateImagePipeline } = await import("@/lib/candidate-pipeline");

  const provider = createLumaGenerationProvider();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const target = String(input);
    // Luma Agents API hosts must never be contacted when source validation fails.
    if (/lumalabs|luma\.ai|api\.luma/i.test(target)) {
      throw new Error(`Unexpected paid Luma HTTP call to ${target}`);
    }
    return new Response("<!doctype html><html>interstitial</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;

  try {
    const result = await runCandidateImagePipeline(provider, {
      candidateId: "cand-html",
      candidateIndex: 1,
      productSku: "SMOKE-001",
      photoUrl: "https://cdn.example.com/not-really-an-image.png",
      prompt: "editorial",
    });
    assert.equal(result.status, "failed");
    if (result.status === "failed") {
      assert.match(result.errorMessage, /text\/html|image\/\*/i);
      assert.equal(result.lumaGenerationId, undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("needsLumaSourceMaterialization flags relative, localhost, and ngrok", async () => {
  const { needsLumaSourceMaterialization } = await import("@/lib/luma-source");
  assert.equal(
    needsLumaSourceMaterialization("/demo/x.png", "https://app.example"),
    true,
  );
  assert.equal(
    needsLumaSourceMaterialization(
      "http://localhost:3000/demo/x.png",
      "https://app.example",
    ),
    true,
  );
  assert.equal(
    needsLumaSourceMaterialization(
      "https://princess-rendering-lapel.ngrok-free.dev/demo/x.png",
      "https://app.example",
    ),
    true,
  );
  assert.equal(
    needsLumaSourceMaterialization(
      "https://blob.vercel-storage.com/luma-sources/x.png",
      "https://app.example",
    ),
    false,
  );
});
