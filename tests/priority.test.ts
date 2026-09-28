import test from "node:test";
import assert from "node:assert/strict";

import { parseCatalogCsv, parseCatalogPriority } from "@/lib/csv";
import {
  catalogPriorityRank,
  selectHighestPrioritySku,
} from "@/lib/request-planning";
import type { CatalogPriority, CatalogRow } from "@/types";

const baseRow = (
  sku: string,
  priority: CatalogPriority,
  extras?: Partial<CatalogRow>,
): CatalogRow => ({
  sku,
  productName: sku,
  category: "Test",
  colorOrFinish: "Test",
  material: "Test",
  priceCents: 1000,
  photoUrl: `/demo/${sku}.png`,
  shotIdea: "soft daylight on a table",
  notes: null,
  priority,
  ...extras,
});

const header =
  "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes,Priority";

test("parseCatalogPriority accepts high, normal, and low", () => {
  assert.equal(parseCatalogPriority("high", "SS-001"), "high");
  assert.equal(parseCatalogPriority("normal", "SS-002"), "normal");
  assert.equal(parseCatalogPriority("low", "SS-003"), "low");
});

test("parseCatalogPriority normalizes case and surrounding whitespace", () => {
  assert.equal(parseCatalogPriority("  HIGH  ", "SS-001"), "high");
  assert.equal(parseCatalogPriority("Normal", "SS-002"), "normal");
  assert.equal(parseCatalogPriority("\tLoW\n", "SS-003"), "low");
});

test("parseCatalogCsv requires the Priority column", () => {
  assert.throws(
    () =>
      parseCatalogCsv(
        [
          "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes",
          "SS-001,Vase,Ceramics,Lilac,Stoneware,$48,/demo/a.png,idea,",
        ].join("\n"),
      ),
    /Missing required CSV header: Priority/,
  );
});

test("parseCatalogCsv rejects empty Priority values", () => {
  assert.throws(
    () =>
      parseCatalogCsv(
        [
          header,
          "SS-001,Vase,Ceramics,Lilac,Stoneware,$48,/demo/a.png,idea,,",
        ].join("\n"),
      ),
    /Missing Priority for SKU SS-001/,
  );
});

test("parseCatalogCsv rejects invalid Priority values", () => {
  assert.throws(
    () =>
      parseCatalogCsv(
        [
          header,
          "SS-001,Vase,Ceramics,Lilac,Stoneware,$48,/demo/a.png,idea,,urgent",
        ].join("\n"),
      ),
    /Invalid Priority for SKU SS-001: "urgent"/,
  );
});

test("catalogPriorityRank orders high > normal > low", () => {
  assert.ok(catalogPriorityRank("high") > catalogPriorityRank("normal"));
  assert.ok(catalogPriorityRank("normal") > catalogPriorityRank("low"));
});

test("selectHighestPrioritySku picks the highest priority", () => {
  const selected = selectHighestPrioritySku([
    { sku: "A", priority: "low" },
    { sku: "B", priority: "high" },
    { sku: "C", priority: "normal" },
  ]);
  assert.deepEqual(selected, { sku: "B", priority: "high" });
});

test("selectHighestPrioritySku preserves CSV order on ties", () => {
  const selected = selectHighestPrioritySku([
    { sku: "FIRST", priority: "normal" },
    { sku: "SECOND", priority: "normal" },
    { sku: "THIRD", priority: "low" },
  ]);
  assert.deepEqual(selected, { sku: "FIRST", priority: "normal" });
});

test("Notes content does not influence priority ranking", () => {
  const selected = selectHighestPrioritySku([
    baseRow("NOTES-LOUD", "low", {
      notes: "do this one first bestseller top seller q4 holiday",
    }),
    baseRow("QUIET-HIGH", "high", { notes: null }),
  ]);
  assert.equal(selected?.sku, "QUIET-HIGH");
  assert.equal(selected?.priority, "high");
});

test("parseCatalogCsv reads Priority into each row", () => {
  const rows = parseCatalogCsv(
    [
      header,
      'SS-001,Lilac Ceramic Vase,Ceramics,Lilac,Stoneware,$48,/demo/ss-001-lilac-vase.png,"soft light",,high',
      "SS-002,Amber Glass Candle,Decor,Amber,Glass,$32,/demo/ss-002-amber-candle.png,evening table,, NORMAL ",
    ].join("\n"),
  );
  assert.equal(rows[0]?.priority, "high");
  assert.equal(rows[1]?.priority, "normal");
});
