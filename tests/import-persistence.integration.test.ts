import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

const envPath = resolve(process.cwd(), ".env.local");
try {
  const contents = readFileSync(envPath, "utf-8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let value = trimmed.slice(eqIdx + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.local is optional for CI without integration tests.
}

const databaseUrl = process.env.DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl);

const testChatId = -1009990001;

const makeSampleRow = (sku: string) => ({
  sku,
  productName: "Integration Test Mug",
  category: "Ceramics",
  colorOrFinish: "Sage",
  material: "Stoneware",
  priceCents: 2800,
  photoUrl: `https://example.com/${sku.toLowerCase()}.jpg`,
  shotIdea: "morning kitchen counter, steam, warm light",
  notes: "integration test",
});

const uniqueSku = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000)}`;

test("persistImportPlan uses neon HTTP transaction batch", { skip: !integrationEnabled }, async (t) => {
  const { getNeonSql } = await import("@/lib/db");
  const {
    buildImportPlan,
    persistImportPlan,
    deleteImportArtifacts,
    stableImportId,
  } = await import("@/lib/imports");
  const { imports, products, shotRequests } = await import("@/lib/schema");
  const { getDb } = await import("@/lib/db");

  const testSku = uniqueSku("TEST-HTTP");
  const sampleRow = makeSampleRow(testSku);
  const telegramUpdateId = 9_300_000_000 + Math.floor(Math.random() * 1_000_000);
  const importId = stableImportId(telegramUpdateId);

  t.after(async () => {
    await deleteImportArtifacts(importId, [testSku]);
  });

  const sql = getNeonSql();
  assert.equal(typeof sql.transaction, "function");

  const plan = await buildImportPlan(
    [sampleRow],
    "http-transaction.csv",
    testChatId,
    telegramUpdateId,
  );
  assert.equal(plan.importId, importId);

  await persistImportPlan(plan);

  const db = getDb();
  const importRows = await db.select().from(imports).where(eq(imports.id, importId));
  assert.equal(importRows.length, 1);

  const productRows = await db.select().from(products).where(eq(products.sku, testSku));
  assert.equal(productRows.length, 1);

  const requestRows = await db
    .select()
    .from(shotRequests)
    .where(eq(shotRequests.importId, importId));
  assert.equal(requestRows.length, 1);
});

test("concurrent persistImportPlan with same telegram_update_id is idempotent", { skip: !integrationEnabled }, async (t) => {
  const {
    buildImportPlan,
    persistImportPlan,
    deleteImportArtifacts,
    stableImportId,
    countImportsByTelegramUpdateId,
  } = await import("@/lib/imports");
  const { shotRequests } = await import("@/lib/schema");
  const { getDb } = await import("@/lib/db");

  const testSku = uniqueSku("TEST-CONC");
  const sampleRow = makeSampleRow(testSku);
  const telegramUpdateId = 9_400_000_000 + Math.floor(Math.random() * 1_000_000);
  const importId = stableImportId(telegramUpdateId);

  t.after(async () => {
    await deleteImportArtifacts(importId, [testSku]);
  });

  const plan = await buildImportPlan(
    [sampleRow],
    "concurrent-http-transaction.csv",
    testChatId,
    telegramUpdateId,
  );

  await Promise.all([persistImportPlan(plan), persistImportPlan(plan)]);

  assert.equal(await countImportsByTelegramUpdateId(telegramUpdateId), 1);

  const db = getDb();
  const requestRows = await db
    .select()
    .from(shotRequests)
    .where(eq(shotRequests.importId, importId));
  assert.equal(requestRows.length, 1);
});

test("import persistence integration", { skip: !integrationEnabled }, async (t) => {
  const { getDb } = await import("@/lib/db");
  const {
    upsertCatalogAndPlanImport,
    deleteImportArtifacts,
  } = await import("@/lib/imports");
  const { imports, products, shotRequests } = await import("@/lib/schema");

  const testSku = uniqueSku("TEST-UPSERT");
  const sampleRow = makeSampleRow(testSku);
  const telegramUpdateId = 9_000_000_000 + Math.floor(Math.random() * 1_000_000);
  let importId: string | null = null;

  t.after(async () => {
    if (importId) {
      await deleteImportArtifacts(importId, [testSku]);
    }
  });

  const summary = await upsertCatalogAndPlanImport(
    [sampleRow],
    "integration-test.csv",
    testChatId,
    telegramUpdateId,
  );
  importId = summary.importId;

  assert.equal(summary.newRequests, 1);
  assert.equal(summary.plannedGenerations, 3);

  const db = getDb();
  const importRows = await db.select().from(imports).where(eq(imports.id, importId));
  assert.equal(importRows.length, 1);
  assert.equal(importRows[0]?.telegramUpdateId, telegramUpdateId);

  const productRows = await db.select().from(products).where(eq(products.sku, testSku));
  assert.equal(productRows.length, 1);

  const requestRows = await db
    .select()
    .from(shotRequests)
    .where(eq(shotRequests.importId, importId));
  assert.equal(requestRows.length, 1);
  assert.equal(requestRows[0]?.productSku, testSku);
  assert.ok(importRows[0], "import row must exist before shot_requests FK is satisfied");
});

test("telegram update retry is idempotent", { skip: !integrationEnabled }, async (t) => {
  const {
    upsertCatalogAndPlanImport,
    deleteImportArtifacts,
    countImportsByTelegramUpdateId,
  } = await import("@/lib/imports");
  const { shotRequests } = await import("@/lib/schema");
  const { getDb } = await import("@/lib/db");
  const { eq } = await import("drizzle-orm");

  const testSku = uniqueSku("TEST-RETRY");
  const sampleRow = makeSampleRow(testSku);
  const telegramUpdateId = 9_100_000_000 + Math.floor(Math.random() * 1_000_000);
  let importId: string | null = null;

  t.after(async () => {
    if (importId) {
      await deleteImportArtifacts(importId, [testSku]);
    }
  });

  const first = await upsertCatalogAndPlanImport(
    [sampleRow],
    "integration-retry.csv",
    testChatId,
    telegramUpdateId,
  );
  importId = first.importId;

  const second = await upsertCatalogAndPlanImport(
    [sampleRow],
    "integration-retry.csv",
    testChatId,
    telegramUpdateId,
  );

  assert.equal(second.alreadyProcessed, true);
  assert.equal(second.importId, first.importId);
  assert.equal(await countImportsByTelegramUpdateId(telegramUpdateId), 1);

  const db = getDb();
  const requestRows = await db
    .select()
    .from(shotRequests)
    .where(eq(shotRequests.importId, importId!));
  assert.equal(requestRows.length, 1);
});

test("unchanged unconfirmed requests remain actionable without duplication", { skip: !integrationEnabled }, async (t) => {
  const { getDb } = await import("@/lib/db");
  const {
    upsertCatalogAndPlanImport,
    deleteImportArtifacts,
  } = await import("@/lib/imports");
  const { shotRequests } = await import("@/lib/schema");
  const { and, eq } = await import("drizzle-orm");
  const { computeRequestHash } = await import("@/lib/request-planning");

  const testSku = uniqueSku("TEST-ACT");
  const sampleRow = makeSampleRow(testSku);
  const priorityRow = {
    ...sampleRow,
    notes: "Hero SKU for demos",
  };

  const telegramUpdateId = 9_500_000_000 + Math.floor(Math.random() * 1_000_000);
  let firstImportId: string | null = null;
  let secondImportId: string | null = null;

  t.after(async () => {
    if (secondImportId) {
      await deleteImportArtifacts(secondImportId, []);
    }
    if (firstImportId) {
      await deleteImportArtifacts(firstImportId, [testSku]);
    }
  });

  const first = await upsertCatalogAndPlanImport(
    [priorityRow],
    "actionable-pending-first.csv",
    testChatId,
    telegramUpdateId,
  );
  firstImportId = first.importId;
  assert.equal(first.newRequests, 1);
  assert.equal(first.existingPendingRequests, 0);
  assert.equal(first.requestsReadyToGenerate, 1);
  assert.equal(first.priorityRequestSku, testSku);

  const second = await upsertCatalogAndPlanImport(
    [priorityRow],
    "actionable-pending-second.csv",
    testChatId,
    telegramUpdateId + 1,
  );
  secondImportId = second.importId;

  assert.equal(second.newRequests, 0);
  assert.equal(second.changedRequests, 0);
  assert.equal(second.unchangedExistingRequests, 1);
  assert.equal(second.existingPendingRequests, 1);
  assert.equal(second.requestsReadyToGenerate, 1);
  assert.equal(second.plannedGenerations, 3);
  assert.equal(second.priorityRequestSku, testSku);

  const db = getDb();
  const requestHash = computeRequestHash(priorityRow);
  const rows = await db
    .select()
    .from(shotRequests)
    .where(and(eq(shotRequests.productSku, testSku), eq(shotRequests.requestHash, requestHash)));
  assert.equal(rows.length, 1);
});

test("unchanged completed requests are not actionable", { skip: !integrationEnabled }, async (t) => {
  const { getDb } = await import("@/lib/db");
  const {
    upsertCatalogAndPlanImport,
    deleteImportArtifacts,
  } = await import("@/lib/imports");
  const { shotRequests } = await import("@/lib/schema");
  const { eq } = await import("drizzle-orm");

  const testSku = uniqueSku("TEST-DONE");
  const sampleRow = makeSampleRow(testSku);
  const telegramUpdateId = 9_510_000_000 + Math.floor(Math.random() * 1_000_000);
  let firstImportId: string | null = null;
  let secondImportId: string | null = null;

  t.after(async () => {
    if (secondImportId) {
      await deleteImportArtifacts(secondImportId, []);
    }
    if (firstImportId) {
      await deleteImportArtifacts(firstImportId, [testSku]);
    }
  });

  const first = await upsertCatalogAndPlanImport(
    [sampleRow],
    "completed-first.csv",
    testChatId,
    telegramUpdateId,
  );
  firstImportId = first.importId;

  const db = getDb();
  await db
    .update(shotRequests)
    .set({ workflowStatus: "completed" })
    .where(eq(shotRequests.importId, first.importId));

  const second = await upsertCatalogAndPlanImport(
    [sampleRow],
    "completed-second.csv",
    testChatId,
    telegramUpdateId + 1,
  );
  secondImportId = second.importId;

  assert.equal(second.unchangedExistingRequests, 1);
  assert.equal(second.existingPendingRequests, 0);
  assert.equal(second.requestsReadyToGenerate, 0);
  assert.equal(second.plannedGenerations, 0);
  assert.equal(second.priorityRequestSku, null);
});

test("identical imports never create duplicate shot requests", { skip: !integrationEnabled }, async (t) => {
  const { getDb } = await import("@/lib/db");
  const {
    upsertCatalogAndPlanImport,
    deleteImportArtifacts,
  } = await import("@/lib/imports");
  const { shotRequests } = await import("@/lib/schema");
  const { and, eq } = await import("drizzle-orm");
  const { computeRequestHash } = await import("@/lib/request-planning");

  const testSku = uniqueSku("TEST-DUP");
  const sampleRow = makeSampleRow(testSku);
  const telegramUpdateId = 9_520_000_000 + Math.floor(Math.random() * 1_000_000);
  let firstImportId: string | null = null;
  let secondImportId: string | null = null;

  t.after(async () => {
    if (secondImportId) {
      await deleteImportArtifacts(secondImportId, []);
    }
    if (firstImportId) {
      await deleteImportArtifacts(firstImportId, [testSku]);
    }
  });

  const first = await upsertCatalogAndPlanImport(
    [sampleRow],
    "duplicate-guard-first.csv",
    testChatId,
    telegramUpdateId,
  );
  firstImportId = first.importId;

  const second = await upsertCatalogAndPlanImport(
    [sampleRow],
    "duplicate-guard-second.csv",
    testChatId,
    telegramUpdateId + 1,
  );
  secondImportId = second.importId;

  assert.equal(second.newRequests, 0);
  assert.equal(second.unchangedExistingRequests, 1);

  const db = getDb();
  const requestHash = computeRequestHash(sampleRow);
  const rows = await db
    .select()
    .from(shotRequests)
    .where(and(eq(shotRequests.productSku, testSku), eq(shotRequests.requestHash, requestHash)));
  assert.equal(rows.length, 1);
});

test("retry succeeds when products already exist from a prior failed import", { skip: !integrationEnabled }, async (t) => {
  const { getDb } = await import("@/lib/db");
  const {
    upsertCatalogAndPlanImport,
    deleteImportArtifacts,
  } = await import("@/lib/imports");
  const { products } = await import("@/lib/schema");

  const testSku = uniqueSku("TEST-PARTIAL");
  const sampleRow = makeSampleRow(testSku);
  const telegramUpdateId = 9_200_000_000 + Math.floor(Math.random() * 1_000_000);
  let importId: string | null = null;

  t.after(async () => {
    if (importId) {
      await deleteImportArtifacts(importId, [testSku]);
    } else {
      const db = getDb();
      await db.delete(products).where(eq(products.sku, testSku));
    }
  });

  const db = getDb();
  await db.insert(products).values({
    sku: testSku,
    productName: sampleRow.productName,
    category: sampleRow.category,
    colorOrFinish: sampleRow.colorOrFinish,
    material: sampleRow.material,
    priceCents: sampleRow.priceCents,
    photoUrl: sampleRow.photoUrl,
  });

  const summary = await upsertCatalogAndPlanImport(
    [sampleRow],
    "integration-partial-products.csv",
    testChatId,
    telegramUpdateId,
  );
  importId = summary.importId;

  assert.equal(summary.newRequests, 1);
  assert.ok(importId);
});
