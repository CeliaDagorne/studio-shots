import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateProductSelection,
  filterActionableOptionsByStatus,
  selectionErrorMessage,
} from "@/lib/product-selection";
import {
  CANDIDATES_PER_REQUEST,
  IMAGE_REF_COST_USD_MICROS,
  formatProductPickerButtonText,
  formatUsdMicros,
  selectHighestPrioritySku,
} from "@/lib/request-planning";
import { WORKFLOW } from "@/lib/review";
import {
  PRODUCT_PICKER_PAGE_SIZE,
  importPreviewKeyboard,
  parseImportCallbackData,
  productPickerKeyboard,
} from "@/lib/telegram";
import type { ActionableProductOption, RequestPlanSummary } from "@/types";
import { requestPlanFromCounts } from "@/lib/request-planning";

const option = (
  requestId: string,
  sku: string,
  priority: ActionableProductOption["priority"],
): ActionableProductOption => ({ requestId, sku, priority });

const summaryWithActionable = (
  actionableProducts: ActionableProductOption[],
  prioritySku: string | null = actionableProducts[0]?.sku ?? null,
): RequestPlanSummary =>
  requestPlanFromCounts({
    importId: "import-1",
    totalCatalogRows: actionableProducts.length,
    rowsWithShotIdea: actionableProducts.length,
    newRequests: actionableProducts.length,
    changedRequests: 0,
    unchangedExistingRequests: 0,
    existingPendingRequests: 0,
    warnings: [],
    actionableProducts,
    priorityRequestSku: prioritySku,
    priorityRequestPriority:
      actionableProducts.find((entry) => entry.sku === prioritySku)?.priority ?? null,
  });

test("import preview offers priority, choose, and cancel — never Generate all", () => {
  const summary = summaryWithActionable([
    option("req-1", "SS-001", "high"),
    option("req-2", "SS-002", "normal"),
  ]);
  const keyboard = importPreviewKeyboard(summary.importId, summary);
  assert.ok(keyboard);
  const labels = keyboard.inline_keyboard.flat().map((button) => button.text);
  const callbacks = keyboard.inline_keyboard.flat().map((button) => button.callback_data);

  assert.equal(labels[0], "Generate priority: SS-001 · ~$0.13");
  assert.equal(labels[1], "Choose a product");
  assert.equal(labels[2], "Cancel");
  assert.equal(callbacks[0], "imp:priority:import-1");
  assert.equal(callbacks[1], "imp:choose:import-1");
  assert.equal(callbacks[2], "imp:cancel:import-1");
  assert.equal(
    labels.some((label) => /generate all/i.test(label)),
    false,
  );
  assert.equal(
    callbacks.some((data) => data.includes(":all:") || data.endsWith(":all")),
    false,
  );
});

test("picker contains only actionable products and shows sku, priority, cost", () => {
  const actionable = [
    option("req-1", "SS-001", "high"),
    option("req-2", "SS-002", "normal"),
  ];
  const live = new Map([
    [
      "req-1",
      { id: "req-1", productSku: "SS-001", workflowStatus: WORKFLOW.importedUnconfirmed },
    ],
    [
      "req-2",
      { id: "req-2", productSku: "SS-002", workflowStatus: WORKFLOW.generating },
    ],
    [
      "req-ghost",
      { id: "req-ghost", productSku: "SS-999", workflowStatus: WORKFLOW.approved },
    ],
  ]);

  const filtered = filterActionableOptionsByStatus(
    [...actionable, option("req-ghost", "SS-999", "low")],
    live,
  );
  assert.deepEqual(filtered.map((entry) => entry.sku), ["SS-001"]);

  const keyboard = productPickerKeyboard("import-1", filtered, 0);
  assert.equal(keyboard.inline_keyboard[0]?.[0]?.text, formatProductPickerButtonText(filtered[0]!));
  assert.match(keyboard.inline_keyboard[0]?.[0]?.text ?? "", /SS-001 · high · ~\$0\.13/);
  assert.equal(keyboard.inline_keyboard[0]?.[0]?.callback_data, "imp:gen:req-1");
  assert.equal(
    formatUsdMicros(CANDIDATES_PER_REQUEST * IMAGE_REF_COST_USD_MICROS),
    "$0.13",
  );
});

test("priority shortcut selects the highest-priority actionable request", () => {
  const actionable = [
    option("req-low", "SS-004", "low"),
    option("req-high", "SS-001", "high"),
    option("req-normal", "SS-002", "normal"),
  ];
  const selected = selectHighestPrioritySku(actionable);
  assert.equal(selected?.sku, "SS-001");
  assert.equal(selected?.priority, "high");

  const summary = summaryWithActionable(actionable, selected?.sku ?? null);
  const keyboard = importPreviewKeyboard(summary.importId, summary);
  assert.equal(keyboard?.inline_keyboard[0]?.[0]?.text, "Generate priority: SS-001 · ~$0.13");
  assert.equal(
    actionable.find((entry) => entry.sku === summary.priorityRequestSku)?.requestId,
    "req-high",
  );
});

test("arbitrary actionable SKU can be selected via gen callback", () => {
  const actionable = [
    option("req-1", "SS-001", "high"),
    option("req-2", "SS-002", "normal"),
  ];
  const parsed = parseImportCallbackData("imp:gen:req-2");
  assert.deepEqual(parsed, { action: "gen", requestId: "req-2" });

  const result = evaluateProductSelection({
    actionable,
    requestId: "req-2",
    request: {
      id: "req-2",
      productSku: "SS-002",
      workflowStatus: WORKFLOW.importedUnconfirmed,
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.option.sku, "SS-002");
  }
});

test("product picker paginates at 6 products with Previous and Next", () => {
  assert.equal(PRODUCT_PICKER_PAGE_SIZE, 6);
  const products = Array.from({ length: 8 }, (_, index) =>
    option(`req-${index + 1}`, `SS-00${index + 1}`, index === 0 ? "high" : "normal"),
  );

  const page0 = productPickerKeyboard("import-1", products, 0);
  assert.equal(page0.inline_keyboard.length, 8); // 6 products + Next + Back/Cancel
  assert.equal(page0.inline_keyboard[0]?.[0]?.callback_data, "imp:gen:req-1");
  assert.equal(page0.inline_keyboard[5]?.[0]?.callback_data, "imp:gen:req-6");
  const page0Nav = page0.inline_keyboard[6] ?? [];
  assert.equal(page0Nav.length, 1);
  assert.equal(page0Nav[0]?.text, "Next");
  assert.equal(page0Nav[0]?.callback_data, "imp:page:import-1:1");
  assert.deepEqual(
    page0.inline_keyboard[7]?.map((button) => button.text),
    ["Back", "Cancel"],
  );

  const page1 = productPickerKeyboard("import-1", products, 1);
  assert.equal(page1.inline_keyboard[0]?.[0]?.callback_data, "imp:gen:req-7");
  assert.equal(page1.inline_keyboard[1]?.[0]?.callback_data, "imp:gen:req-8");
  const page1Nav = page1.inline_keyboard[2] ?? [];
  assert.equal(page1Nav[0]?.text, "Previous");
  assert.equal(page1Nav[0]?.callback_data, "imp:page:import-1:0");
});

test("Back and Cancel callback payloads are stable", () => {
  assert.deepEqual(parseImportCallbackData("imp:back:import-1"), {
    action: "back",
    importId: "import-1",
  });
  assert.deepEqual(parseImportCallbackData("imp:cancel:import-1"), {
    action: "cancel",
    importId: "import-1",
  });
  assert.deepEqual(parseImportCallbackData("imp:choose:import-1"), {
    action: "choose",
    importId: "import-1",
  });
});

test("invalid or stale selections are rejected with clear reasons", () => {
  const actionable = [option("req-1", "SS-001", "high")];

  assert.equal(
    evaluateProductSelection({
      actionable,
      requestId: "missing",
      request: null,
    }).ok,
    false,
  );
  assert.equal(
    selectionErrorMessage("not_in_import"),
    "That product is not part of this import selection.",
  );

  const stale = evaluateProductSelection({
    actionable,
    requestId: "req-1",
    request: {
      id: "req-1",
      productSku: "SS-001",
      workflowStatus: WORKFLOW.generating,
    },
  });
  assert.deepEqual(stale, { ok: false, reason: "unavailable" });
  assert.equal(
    selectionErrorMessage("unavailable"),
    "That product is no longer available to generate.",
  );
});

test("request/import mismatch is rejected", () => {
  const result = evaluateProductSelection({
    actionable: [option("req-1", "SS-001", "high")],
    requestId: "req-1",
    request: {
      id: "req-1",
      productSku: "OTHER",
      workflowStatus: WORKFLOW.importedUnconfirmed,
    },
  });
  assert.deepEqual(result, { ok: false, reason: "mismatch" });
  assert.equal(selectionErrorMessage("mismatch"), "Request does not match this import.");
});

test("repeated selection of the same request is safe at the claim layer contract", async () => {
  // Double-clicks are serialized by claimShotRequestForGeneration: only
  // imported_unconfirmed → generating succeeds. This unit test locks the
  // selection gate: a second evaluation against a claimed row is unavailable.
  const actionable = [option("req-1", "SS-001", "high")];
  const first = evaluateProductSelection({
    actionable,
    requestId: "req-1",
    request: {
      id: "req-1",
      productSku: "SS-001",
      workflowStatus: WORKFLOW.importedUnconfirmed,
    },
  });
  const second = evaluateProductSelection({
    actionable,
    requestId: "req-1",
    request: {
      id: "req-1",
      productSku: "SS-001",
      workflowStatus: WORKFLOW.generating,
    },
  });
  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: false, reason: "unavailable" });
});

test("callback parser rejects unknown and Generate-all style actions", () => {
  assert.equal(parseImportCallbackData("imp:all:import-1"), null);
  assert.equal(parseImportCallbackData("imp:generate_all:import-1"), null);
  assert.equal(parseImportCallbackData("cand:approve:x"), null);
});
