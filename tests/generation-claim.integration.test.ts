import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import {
  telegramConversation,
  toExternalEventId,
} from "@/lib/chat-identity";

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
  // optional
}

const databaseUrl = process.env.DATABASE_URL;
const integrationEnabled = Boolean(databaseUrl);

const testSku = "TEST-GEN-001";
const testConversation = telegramConversation(-1009990002);

const sampleRow = {
  sku: testSku,
  productName: "Generation Test Mug",
  category: "Ceramics",
  colorOrFinish: "Sage",
  material: "Stoneware",
  priceCents: 2800,
  photoUrl: "https://example.com/test-gen-001.jpg",
  shotIdea: "morning kitchen counter, steam, warm light",
  notes: "integration test",
  priority: "high" as const,
};

test("atomic claim moves imported_unconfirmed to generating once", { skip: !integrationEnabled }, async (t) => {
  const { getDb } = await import("@/lib/db");
  const { upsertCatalogAndPlanImport, deleteImportArtifacts } = await import("@/lib/imports");
  const { claimShotRequestForGeneration } = await import("@/lib/generation");
  const { shotRequests } = await import("@/lib/schema");
  const { WORKFLOW } = await import("@/lib/review");

  const telegramUpdateId = 9_600_000_000 + Math.floor(Math.random() * 1_000_000);
  let importId: string | null = null;

  t.after(async () => {
    if (importId) {
      await deleteImportArtifacts(importId, [testSku]);
    }
  });

  const summary = await upsertCatalogAndPlanImport(
    [sampleRow],
    "claim-test.csv",
    testConversation,
    toExternalEventId(telegramUpdateId),
  );
  importId = summary.importId;

  const db = getDb();
  const requests = await db
    .select()
    .from(shotRequests)
    .where(eq(shotRequests.importId, importId));
  assert.equal(requests.length, 1);
  const requestId = requests[0]!.id;

  const [first, second] = await Promise.all([
    claimShotRequestForGeneration(requestId),
    claimShotRequestForGeneration(requestId),
  ]);

  const winners = [first, second].filter(Boolean);
  assert.equal(winners.length, 1);
  assert.equal(winners[0]?.workflowStatus, WORKFLOW.generating);

  const after = await db.select().from(shotRequests).where(eq(shotRequests.id, requestId));
  assert.equal(after[0]?.workflowStatus, WORKFLOW.generating);
});
