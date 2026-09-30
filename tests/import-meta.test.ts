import assert from "node:assert/strict";
import test from "node:test";

import {
  parseImportWarningsPayload,
  serializeImportWarningsPayload,
} from "@/lib/import-meta";

test("serializeImportWarningsPayload stores catalog showcase products", () => {
  const actionable = [{ requestId: "req-2", sku: "SS-002", priority: "normal" as const }];
  const catalogProducts = [
    { requestId: "req-1", sku: "SS-001", priority: "high" as const },
    { requestId: "req-2", sku: "SS-002", priority: "normal" as const },
  ];
  const payload = serializeImportWarningsPayload([], actionable, catalogProducts);
  assert.equal(payload.actionable.length, 1);
  assert.equal(payload.catalogProducts?.length, 2);
  assert.equal(payload.catalogProducts?.[0]?.sku, "SS-001");
});

test("parseImportWarningsPayload reads catalog products and stays backward compatible", () => {
  const withCatalog = parseImportWarningsPayload({
    warnings: [],
    actionable: [{ requestId: "req-2", sku: "SS-002", priority: "normal" }],
    catalogProducts: [
      { requestId: "req-1", sku: "SS-001", priority: "high" },
      { requestId: "req-2", sku: "SS-002", priority: "normal" },
    ],
  });
  assert.equal(withCatalog.catalogProducts?.length, 2);

  const legacyObject = parseImportWarningsPayload({
    warnings: [{ sku: "SS-001", message: "note" }],
    actionable: [{ requestId: "req-1", sku: "SS-001", priority: "high" }],
  });
  assert.deepEqual(legacyObject.catalogProducts, []);
  assert.equal(legacyObject.actionable.length, 1);

  const legacyArray = parseImportWarningsPayload([{ sku: "SS-001", message: "note" }]);
  assert.equal(legacyArray.warnings.length, 1);
  assert.deepEqual(legacyArray.catalogProducts, []);
});
