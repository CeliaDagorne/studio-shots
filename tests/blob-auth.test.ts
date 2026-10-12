import assert from "node:assert/strict";
import test from "node:test";

test("getBlobAuthStatus accepts OIDC + BLOB_STORE_ID without RW token", async () => {
  const previous = {
    oidc: process.env.VERCEL_OIDC_TOKEN,
    store: process.env.BLOB_STORE_ID,
    rw: process.env.BLOB_READ_WRITE_TOKEN,
  };
  try {
    process.env.VERCEL_OIDC_TOKEN = "oidc-test-token";
    process.env.BLOB_STORE_ID = "store_test";
    delete process.env.BLOB_READ_WRITE_TOKEN;

    const { getBlobAuthStatus, getBlobCommandOptions, assertBlobAuthConfigured } =
      await import("@/lib/blob-auth");
    const status = getBlobAuthStatus();
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.mode, "oidc");
    }
    assert.equal(assertBlobAuthConfigured(), "oidc");
    assert.deepEqual(getBlobCommandOptions(), {
      oidcToken: "oidc-test-token",
      storeId: "store_test",
    });
  } finally {
    if (previous.oidc === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = previous.oidc;
    if (previous.store === undefined) delete process.env.BLOB_STORE_ID;
    else process.env.BLOB_STORE_ID = previous.store;
    if (previous.rw === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previous.rw;
  }
});

test("getBlobAuthStatus accepts BLOB_READ_WRITE_TOKEN as legacy fallback", async () => {
  const previous = {
    oidc: process.env.VERCEL_OIDC_TOKEN,
    store: process.env.BLOB_STORE_ID,
    rw: process.env.BLOB_READ_WRITE_TOKEN,
  };
  try {
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.BLOB_STORE_ID;
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";

    const { getBlobAuthStatus, getBlobCommandOptions } = await import("@/lib/blob-auth");
    const status = getBlobAuthStatus();
    assert.equal(status.ok, true);
    if (status.ok) {
      assert.equal(status.mode, "rw_token");
    }
    assert.deepEqual(getBlobCommandOptions(), { token: "vercel_blob_rw_test" });
  } finally {
    if (previous.oidc === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = previous.oidc;
    if (previous.store === undefined) delete process.env.BLOB_STORE_ID;
    else process.env.BLOB_STORE_ID = previous.store;
    if (previous.rw === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previous.rw;
  }
});

test("preflight does not require BLOB_READ_WRITE_TOKEN when OIDC is configured", async () => {
  const previous = {
    oidc: process.env.VERCEL_OIDC_TOKEN,
    store: process.env.BLOB_STORE_ID,
    rw: process.env.BLOB_READ_WRITE_TOKEN,
  };
  try {
    process.env.VERCEL_OIDC_TOKEN = "oidc-test-token";
    process.env.BLOB_STORE_ID = "store_test";
    delete process.env.BLOB_READ_WRITE_TOKEN;

    const { getBlobAuthStatus } = await import("@/lib/blob-auth");
    const status = getBlobAuthStatus();
    assert.equal(status.ok, true);
    assert.equal(process.env.BLOB_READ_WRITE_TOKEN, undefined);
  } finally {
    if (previous.oidc === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = previous.oidc;
    if (previous.store === undefined) delete process.env.BLOB_STORE_ID;
    else process.env.BLOB_STORE_ID = previous.store;
    if (previous.rw === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previous.rw;
  }
});

test("missing auth explains OIDC and RW fallback without mentioning only RW", async () => {
  const previous = {
    oidc: process.env.VERCEL_OIDC_TOKEN,
    store: process.env.BLOB_STORE_ID,
    rw: process.env.BLOB_READ_WRITE_TOKEN,
  };
  try {
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.BLOB_STORE_ID;
    delete process.env.BLOB_READ_WRITE_TOKEN;

    const { getBlobAuthStatus } = await import("@/lib/blob-auth");
    const status = getBlobAuthStatus();
    assert.equal(status.ok, false);
    if (!status.ok) {
      assert.match(status.message, /VERCEL_OIDC_TOKEN/);
      assert.match(status.message, /BLOB_STORE_ID/);
      assert.match(status.message, /BLOB_READ_WRITE_TOKEN/);
      assert.match(status.message, /legacy\/external-runtime fallback/i);
    }
  } finally {
    if (previous.oidc === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = previous.oidc;
    if (previous.store === undefined) delete process.env.BLOB_STORE_ID;
    else process.env.BLOB_STORE_ID = previous.store;
    if (previous.rw === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previous.rw;
  }
});
