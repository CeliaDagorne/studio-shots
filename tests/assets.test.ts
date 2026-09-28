import test from "node:test";
import assert from "node:assert/strict";

import { resolvePublicAssetUrl } from "@/lib/assets";

test("resolvePublicAssetUrl keeps absolute URLs", () => {
  assert.equal(
    resolvePublicAssetUrl("https://cdn.example.com/a.jpg", "https://app.example.com"),
    "https://cdn.example.com/a.jpg",
  );
});

test("resolvePublicAssetUrl joins root-relative demo paths to APP_URL", () => {
  assert.equal(
    resolvePublicAssetUrl("/demo/ss-001-lilac-vase.png", "https://studio-shots.example.com/"),
    "https://studio-shots.example.com/demo/ss-001-lilac-vase.png",
  );
});
