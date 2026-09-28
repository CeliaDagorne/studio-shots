import test from "node:test";
import assert from "node:assert/strict";

import { parseCatalogCsv } from "@/lib/csv";
import {
  classifyRequestChange,
  computeRequestHash,
  formatUsdMicros,
  IMAGE_REF_COST_USD_MICROS,
} from "@/lib/request-planning";

test("parseCatalogCsv handles quoted commas in Shot Idea", () => {
  const rows = parseCatalogCsv(
    [
      "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes,Priority",
      'SS-001,Lilac Ceramic Vase,Ceramics,Lilac,Stoneware,$48,/demo/ss-001-lilac-vase.png,"sunlit console table by a window, single stem of dried grasses, soft morning light","Hero SKU for demos",100',
    ].join("\n"),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sku, "SS-001");
  assert.equal(rows[0]?.productName, "Lilac Ceramic Vase");
  assert.equal(
    rows[0]?.shotIdea,
    "sunlit console table by a window, single stem of dried grasses, soft morning light",
  );
  assert.equal(rows[0]?.notes, "Hero SKU for demos");
  assert.equal(rows[0]?.photoUrl, "/demo/ss-001-lilac-vase.png");
  assert.equal(rows[0]?.priceCents, 4800);
});

test("classifyRequestChange is idempotent for identical shot request content", () => {
  const row = {
    sku: "SS-001",
    productName: "Lilac Ceramic Vase",
    category: "Ceramics",
    colorOrFinish: "Lilac",
    material: "Stoneware",
    priceCents: 4800,
    photoUrl: "/demo/ss-001-lilac-vase.png",
    shotIdea: "sunlit console table by a window, single stem of dried grasses, soft morning light",
    notes: "Hero SKU for demos",
  };

  const requestHash = computeRequestHash(row);
  assert.equal(classifyRequestChange(row, [{ requestHash }]), "none");
});

test("classifyRequestChange treats changed shot idea as actionable change", () => {
  const oldRow = {
    sku: "SS-001",
    productName: "Lilac Ceramic Vase",
    category: "Ceramics",
    colorOrFinish: "Lilac",
    material: "Stoneware",
    priceCents: 4800,
    photoUrl: "/demo/ss-001-lilac-vase.png",
    shotIdea: "sunlit console table by a window, single stem of dried grasses, soft morning light",
    notes: "Hero SKU for demos",
  };

  const newRow = { ...oldRow, shotIdea: "mantel shelf with soft afternoon light" };
  assert.equal(
    classifyRequestChange(newRow, [{ requestHash: computeRequestHash(oldRow) }]),
    "changed",
  );
});

test("cost formatting stays precision-safe in integer micros", () => {
  const costMicros = 16 * 3 * IMAGE_REF_COST_USD_MICROS;
  assert.equal(costMicros, 2_083_200);
  assert.equal(formatUsdMicros(costMicros), "$2.08");
});
