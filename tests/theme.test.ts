import assert from "node:assert/strict";
import test from "node:test";

import {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  resolveThemePreference,
} from "@/lib/theme";

test("resolveThemePreference prefers stored light/dark over system", () => {
  assert.equal(resolveThemePreference("dark", false), "dark");
  assert.equal(resolveThemePreference("light", true), "light");
});

test("resolveThemePreference falls back to system preference", () => {
  assert.equal(resolveThemePreference(null, true), "dark");
  assert.equal(resolveThemePreference("nope", false), "light");
  assert.equal(resolveThemePreference("", true), "dark");
});

test("theme bootstrap script is inline-safe and references the storage key", () => {
  assert.match(THEME_BOOTSTRAP_SCRIPT, new RegExp(THEME_STORAGE_KEY));
  assert.match(THEME_BOOTSTRAP_SCRIPT, /data-theme/);
  assert.match(THEME_BOOTSTRAP_SCRIPT, /colorScheme/);
  assert.match(THEME_BOOTSTRAP_SCRIPT, /prefers-color-scheme:\s*dark/);
  assert.doesNotMatch(THEME_BOOTSTRAP_SCRIPT, /import |require\(/);
});
