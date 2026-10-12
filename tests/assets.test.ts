import test from "node:test";
import assert from "node:assert/strict";

import { resolvePublicAssetUrl } from "@/lib/assets";
import {
  isSlackAccessibleImageUrl,
  resolveSlackImageUrl,
} from "@/lib/slack-image-url";

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

test("Slack image URLs must be public absolute HTTPS", () => {
  assert.equal(isSlackAccessibleImageUrl("https://cdn.example.com/a.png"), true);
  assert.equal(isSlackAccessibleImageUrl("/demo/a.png"), false);
  assert.equal(isSlackAccessibleImageUrl("http://localhost:3000/demo/a.png"), false);
  assert.equal(
    resolveSlackImageUrl("/demo/a.png", "https://public.example"),
    "https://public.example/demo/a.png",
  );
  assert.equal(resolveSlackImageUrl("/demo/a.png", "http://localhost:3000"), null);
});
