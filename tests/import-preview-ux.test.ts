import test from "node:test";
import assert from "node:assert/strict";

import {
  buildImportPreviewText,
  IMPORT_UP_TO_DATE_MESSAGE,
  requestPlanFromCounts,
} from "@/lib/request-planning";
import { importPreviewKeyboard, removeInlineKeyboard } from "@/lib/telegram";
import type { RequestPlanSummary } from "@/types";

const baseSummary = (overrides: Partial<RequestPlanSummary> = {}): RequestPlanSummary =>
  requestPlanFromCounts({
    importId: "test-import-id",
    totalCatalogRows: 40,
    rowsWithShotIdea: 16,
    newRequests: 0,
    changedRequests: 0,
    unchangedExistingRequests: 16,
    existingPendingRequests: 0,
    warnings: [],
    priorityRequestSku: null,
    priorityRequestPriority: null,
    ...overrides,
  });

test("importPreviewKeyboard omits buttons when no requests are ready to generate", () => {
  const summary = baseSummary({ existingPendingRequests: 0 });
  assert.equal(summary.requestsReadyToGenerate, 0);
  assert.equal(summary.plannedGenerations, 0);
  assert.equal(importPreviewKeyboard(summary.importId, summary), undefined);
});

test("importPreviewKeyboard includes generate actions for pending unchanged requests", () => {
  const summary = baseSummary({
    existingPendingRequests: 16,
    priorityRequestSku: "SS-001",
    priorityRequestPriority: "high",
  });
  assert.equal(summary.requestsReadyToGenerate, 16);
  assert.equal(summary.plannedGenerations, 48);
  assert.equal(summary.additionalEstimatedCostMicrosUsd, 2_083_200);

  const keyboard = importPreviewKeyboard(summary.importId, summary);
  assert.ok(keyboard);
  assert.equal(keyboard.inline_keyboard.length, 3);
  assert.match(keyboard.inline_keyboard[0]?.[0]?.callback_data ?? "", /imp:priority:test-import-id/);
  assert.equal(keyboard.inline_keyboard[0]?.[0]?.text, "Generate priority: SS-001 · ~$0.13");
  assert.equal(keyboard.inline_keyboard[1]?.[0]?.text, "Choose a product");
  assert.equal(keyboard.inline_keyboard[2]?.[0]?.text, "Cancel");
});

test("buildImportPreviewText includes up-to-date message only when nothing is actionable", () => {
  const idle = buildImportPreviewText(baseSummary({ existingPendingRequests: 0 }));
  assert.match(idle, new RegExp(IMPORT_UP_TO_DATE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const pending = buildImportPreviewText(
    baseSummary({
      existingPendingRequests: 16,
      priorityRequestSku: "SS-001",
      priorityRequestPriority: "high",
    }),
  );
  assert.doesNotMatch(
    pending,
    new RegExp(IMPORT_UP_TO_DATE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(pending, /Existing pending requests: 16/);
  assert.match(pending, /Requests ready to generate: 16/);
  assert.match(pending, /Planned generations: 48/);
  assert.match(pending, /Additional estimated cost \(all ready products\): \$2\.08/);
  assert.match(pending, /Estimated cost per product: \$0\.13 \(3 candidates\)/);
  assert.match(pending, /Priority request: SS-001 \(high\)/);
});

test("removeInlineKeyboard clears stale inline buttons", () => {
  assert.deepEqual(removeInlineKeyboard(), { inline_keyboard: [] });
});
