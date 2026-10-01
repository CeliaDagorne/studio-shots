import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  type ChatConversation,
  type ChatPlatform,
} from "@/lib/chat-identity";
import { getDb, getNeonSql } from "@/lib/db";
import { collectCatalogWarnings } from "@/lib/csv";
import {
  parseImportWarningsPayload,
  serializeImportWarningsPayload,
} from "@/lib/import-meta";
import { filterActionableOptionsByStatus } from "@/lib/product-selection";
import {
  classifyRequestChange,
  catalogPriorityRank,
  computeRequestHash,
  isActionableWorkflowStatus,
  requestPlanFromCounts,
} from "@/lib/request-planning";
import { generationCandidates, imports, products, shotRequests } from "@/lib/schema";
import type {
  ActionableProductOption,
  CatalogPriority,
  CatalogRow,
  ImportResult,
  RequestPlanSummary,
} from "@/types";

const now = () => new Date();

const hashToUuid = (hex: string): string =>
  [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");

export const stableImportId = (
  platform: ChatPlatform,
  externalEventId: string,
): string =>
  hashToUuid(
    createHash("sha256")
      .update(`import:${platform}:${externalEventId}`)
      .digest("hex"),
  );

export const stableShotRequestId = (
  importId: string,
  productSku: string,
  requestHash: string,
): string =>
  hashToUuid(
    createHash("sha256").update(`shot:${importId}:${productSku}:${requestHash}`).digest("hex"),
  );

const productChanged = (
  existing: typeof products.$inferSelect | undefined,
  incoming: CatalogRow,
): boolean =>
  !existing ||
  existing.productName !== incoming.productName ||
  existing.category !== incoming.category ||
  existing.colorOrFinish !== incoming.colorOrFinish ||
  existing.material !== incoming.material ||
  existing.priceCents !== incoming.priceCents ||
  existing.photoUrl !== incoming.photoUrl;

export const formatUsdMicros = (micros: number): string => {
  const dollars = Math.floor(micros / 1_000_000);
  const cents = Math.round((micros % 1_000_000) / 10_000);
  return `$${dollars}.${String(cents).padStart(2, "0")}`;
};

export type ImportPersistPlan = {
  importId: string;
  importRow: typeof imports.$inferInsert;
  productInserts: Array<typeof products.$inferInsert>;
  productUpdates: Array<{
    sku: string;
    values: Partial<typeof products.$inferInsert>;
  }>;
  shotRequestInserts: Array<typeof shotRequests.$inferInsert>;
  summary: RequestPlanSummary;
};

const isExternalEventConflict = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("imports_platform_external_event_idx") ||
    message.includes("external_event_id")
  );
};

export const findImportByExternalEvent = async (
  platform: ChatPlatform,
  externalEventId: string,
) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(imports)
    .where(
      and(eq(imports.platform, platform), eq(imports.externalEventId, externalEventId)),
    )
    .limit(1);

  return rows[0] ?? null;
};

export const buildImportPlan = async (
  rows: CatalogRow[],
  filename: string,
  conversation: ChatConversation,
  externalEventId: string,
): Promise<ImportPersistPlan> => {
  const db = getDb();
  const importId = stableImportId(conversation.platform, externalEventId);
  const skus = rows.map((row) => row.sku);

  const existingProducts = skus.length
    ? await db.select().from(products).where(inArray(products.sku, skus))
    : [];
  const existingRequests = skus.length
    ? await db
        .select()
        .from(shotRequests)
        .where(inArray(shotRequests.productSku, skus))
        .orderBy(desc(shotRequests.createdAt))
    : [];

  const productBySku = new Map(existingProducts.map((row) => [row.sku, row]));
  const requestsBySku = new Map<string, typeof existingRequests>();
  for (const request of existingRequests) {
    const group = requestsBySku.get(request.productSku) ?? [];
    group.push(request);
    requestsBySku.set(request.productSku, group);
  }

  const productInserts: ImportPersistPlan["productInserts"] = [];
  const productUpdates: ImportPersistPlan["productUpdates"] = [];
  const shotRequestInserts: ImportPersistPlan["shotRequestInserts"] = [];

  let rowsWithShotIdea = 0;
  let newRequests = 0;
  let changedRequests = 0;
  let unchangedExistingRequests = 0;
  let existingPendingRequests = 0;
  let prioritySku: string | null = null;
  let priorityLevel: CatalogPriority | null = null;
  let bestPriorityRank = 0;
  const actionableProducts: ActionableProductOption[] = [];
  const catalogProducts: ActionableProductOption[] = [];

  const considerPriority = (row: CatalogRow) => {
    const rank = catalogPriorityRank(row.priority);
    if (rank > bestPriorityRank) {
      bestPriorityRank = rank;
      prioritySku = row.sku;
      priorityLevel = row.priority;
    }
  };

  const rememberCatalog = (requestId: string, row: CatalogRow) => {
    catalogProducts.push({
      requestId,
      sku: row.sku,
      priority: row.priority,
    });
  };

  const rememberActionable = (requestId: string, row: CatalogRow) => {
    actionableProducts.push({
      requestId,
      sku: row.sku,
      priority: row.priority,
    });
    rememberCatalog(requestId, row);
    considerPriority(row);
  };

  for (const row of rows) {
    const existingProduct = productBySku.get(row.sku);
    if (!existingProduct) {
      productInserts.push({
        sku: row.sku,
        productName: row.productName,
        category: row.category,
        colorOrFinish: row.colorOrFinish,
        material: row.material,
        priceCents: row.priceCents,
        photoUrl: row.photoUrl,
      });
    } else if (productChanged(existingProduct, row)) {
      productUpdates.push({
        sku: row.sku,
        values: {
          productName: row.productName,
          category: row.category,
          colorOrFinish: row.colorOrFinish,
          material: row.material,
          priceCents: row.priceCents,
          photoUrl: row.photoUrl,
          updatedAt: now(),
        },
      });
    }

    if (!row.shotIdea) {
      continue;
    }

    rowsWithShotIdea += 1;

    const priorRequests = requestsBySku.get(row.sku) ?? [];
    const classification = classifyRequestChange(row, priorRequests);

    if (classification === "none") {
      unchangedExistingRequests += 1;
      const requestHash = computeRequestHash(row);
      const matchingRequest = priorRequests.find((request) => request.requestHash === requestHash);
      if (matchingRequest && isActionableWorkflowStatus(matchingRequest.workflowStatus)) {
        existingPendingRequests += 1;
        rememberActionable(matchingRequest.id, row);
      } else if (matchingRequest) {
        // Keep completed / in-progress SKUs on the campaign overview even when
        // they are no longer selectable for generation.
        rememberCatalog(matchingRequest.id, row);
      }
      continue;
    }

    const latestRequest = priorRequests[0];
    const requestHash = computeRequestHash(row);
    if (classification === "new") {
      newRequests += 1;
    } else {
      changedRequests += 1;
    }

    const newRequest = {
      id: stableShotRequestId(importId, row.sku, requestHash),
      productSku: row.sku,
      importId,
      supersedesRequestId: latestRequest?.id ?? null,
      shotIdea: row.shotIdea,
      notesSnapshot: row.notes,
      requestHash,
      workflowStatus: "imported_unconfirmed",
      approvedCount: 0,
      updatedAt: now(),
    };

    shotRequestInserts.push(newRequest);
    rememberActionable(newRequest.id, row);
    const nextRequests = [newRequest, ...priorRequests];
    requestsBySku.set(row.sku, nextRequests as typeof existingRequests);
  }

  const warnings = collectCatalogWarnings(rows);
  const summary = requestPlanFromCounts({
    importId,
    totalCatalogRows: rows.length,
    rowsWithShotIdea,
    newRequests,
    changedRequests,
    unchangedExistingRequests,
    existingPendingRequests,
    warnings,
    actionableProducts,
    priorityRequestSku: prioritySku,
    priorityRequestPriority: priorityLevel,
  });

  return {
    importId,
    importRow: {
      id: importId,
      filename,
      totalCatalogRows: summary.totalCatalogRows,
      rowsWithShotIdea: summary.rowsWithShotIdea,
      newRequests: summary.newRequests,
      changedRequests: summary.changedRequests,
      unchangedExistingRequests: summary.unchangedExistingRequests,
      existingPendingRequests: summary.existingPendingRequests,
      requestsReadyToGenerate: summary.requestsReadyToGenerate,
      plannedGenerations: summary.plannedGenerations,
      additionalEstimatedCostMicrosUsd: summary.additionalEstimatedCostMicrosUsd,
      warnings: serializeImportWarningsPayload(warnings, actionableProducts, catalogProducts),
      priorityRequestSku: summary.priorityRequestSku,
      platform: conversation.platform,
      conversationId: conversation.conversationId,
      externalEventId,
    },
    productInserts,
    productUpdates,
    shotRequestInserts,
    summary,
  };
};

export const persistImportPlan = async (plan: ImportPersistPlan): Promise<void> => {
  const sql = getNeonSql();
  const row = plan.importRow;
  const queries = [
    sql`
      INSERT INTO imports (
        id,
        filename,
        total_catalog_rows,
        rows_with_shot_idea,
        new_requests,
        changed_requests,
        unchanged_existing_requests,
        existing_pending_requests,
        requests_ready_to_generate,
        planned_generations,
        additional_estimated_cost_micros_usd,
        warnings,
        priority_request_sku,
        platform,
        conversation_id,
        external_event_id
      ) VALUES (
        ${row.id},
        ${row.filename},
        ${row.totalCatalogRows},
        ${row.rowsWithShotIdea},
        ${row.newRequests},
        ${row.changedRequests},
        ${row.unchangedExistingRequests},
        ${row.existingPendingRequests},
        ${row.requestsReadyToGenerate},
        ${row.plannedGenerations},
        ${row.additionalEstimatedCostMicrosUsd},
        ${JSON.stringify(row.warnings)}::jsonb,
        ${row.priorityRequestSku},
        ${row.platform},
        ${row.conversationId},
        ${row.externalEventId}
      )
      ON CONFLICT (platform, external_event_id) DO NOTHING
    `,
  ];

  for (const product of plan.productInserts) {
    queries.push(
      sql`
        INSERT INTO products (
          sku,
          product_name,
          category,
          color_or_finish,
          material,
          price_cents,
          photo_url
        ) VALUES (
          ${product.sku},
          ${product.productName},
          ${product.category},
          ${product.colorOrFinish},
          ${product.material},
          ${product.priceCents},
          ${product.photoUrl}
        )
        ON CONFLICT (sku) DO UPDATE SET
          product_name = EXCLUDED.product_name,
          category = EXCLUDED.category,
          color_or_finish = EXCLUDED.color_or_finish,
          material = EXCLUDED.material,
          price_cents = EXCLUDED.price_cents,
          photo_url = EXCLUDED.photo_url,
          updated_at = NOW()
      `,
    );
  }

  for (const update of plan.productUpdates) {
    const values = update.values;
    queries.push(
      sql`
        INSERT INTO products (
          sku,
          product_name,
          category,
          color_or_finish,
          material,
          price_cents,
          photo_url
        ) VALUES (
          ${update.sku},
          ${values.productName!},
          ${values.category!},
          ${values.colorOrFinish!},
          ${values.material!},
          ${values.priceCents!},
          ${values.photoUrl!}
        )
        ON CONFLICT (sku) DO UPDATE SET
          product_name = EXCLUDED.product_name,
          category = EXCLUDED.category,
          color_or_finish = EXCLUDED.color_or_finish,
          material = EXCLUDED.material,
          price_cents = EXCLUDED.price_cents,
          photo_url = EXCLUDED.photo_url,
          updated_at = NOW()
      `,
    );
  }

  for (const request of plan.shotRequestInserts) {
    queries.push(
      sql`
        INSERT INTO shot_requests (
          id,
          product_sku,
          import_id,
          supersedes_request_id,
          shot_idea,
          notes_snapshot,
          request_hash,
          workflow_status,
          approved_count
        ) VALUES (
          ${request.id},
          ${request.productSku},
          ${request.importId},
          ${request.supersedesRequestId},
          ${request.shotIdea},
          ${request.notesSnapshot},
          ${request.requestHash},
          ${request.workflowStatus},
          ${request.approvedCount ?? 0}
        )
        ON CONFLICT (product_sku, request_hash) DO NOTHING
      `,
    );
  }

  await sql.transaction(queries);
};

export const upsertCatalogAndPlanImport = async (
  rows: CatalogRow[],
  filename: string,
  conversation: ChatConversation,
  externalEventId: string,
): Promise<ImportResult> => {
  const existing = await findImportByExternalEvent(
    conversation.platform,
    externalEventId,
  );
  if (existing) {
    return {
      ...importRecordToSummary(existing),
      alreadyProcessed: true,
      previewMessageId: existing.previewMessageId,
    };
  }

  const plan = await buildImportPlan(rows, filename, conversation, externalEventId);

  try {
    await persistImportPlan(plan);
  } catch (error) {
    if (isExternalEventConflict(error)) {
      const raced = await findImportByExternalEvent(
        conversation.platform,
        externalEventId,
      );
      if (raced) {
        return {
          ...importRecordToSummary(raced),
          alreadyProcessed: true,
          previewMessageId: raced.previewMessageId,
        };
      }
    }

    throw error;
  }

  return plan.summary;
};

export const setPreviewMessageId = async (
  importId: string,
  previewMessageId: string,
) => {
  const db = getDb();
  await db
    .update(imports)
    .set({ previewMessageId })
    .where(eq(imports.id, importId));
};

export const cancelImport = async (importId: string): Promise<boolean> => {
  const db = getDb();
  const updated = await db
    .update(imports)
    .set({
      confirmationAction: "cancelled",
      confirmedAt: now(),
    })
    .where(and(eq(imports.id, importId), sql`${imports.confirmationAction} IS NULL`))
    .returning({ id: imports.id });

  return updated.length > 0;
};

/** @deprecated Prefer cancelImport — generation no longer locks the import row. */
export const confirmImport = async (
  importId: string,
  action: "cancelled",
): Promise<boolean> => {
  if (action !== "cancelled") {
    return false;
  }
  return cancelImport(importId);
};

export const getImportByPreviewMessage = async (
  conversation: ChatConversation,
  previewMessageId: string,
) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(imports)
    .where(
      and(
        eq(imports.platform, conversation.platform),
        eq(imports.conversationId, conversation.conversationId),
        eq(imports.previewMessageId, previewMessageId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
};

export const getImportById = async (importId: string) => {
  const db = getDb();
  const rows = await db.select().from(imports).where(eq(imports.id, importId)).limit(1);
  return rows[0] ?? null;
};

/** Latest persisted campaign for a chat conversation (Slack channel / Telegram chat). */
export const getLatestImportForConversation = async (conversation: ChatConversation) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(imports)
    .where(
      and(
        eq(imports.platform, conversation.platform),
        eq(imports.conversationId, conversation.conversationId),
      ),
    )
    .orderBy(desc(imports.createdAt))
    .limit(1);

  return rows[0] ?? null;
};

export const listActionableProductsForImport = (
  record: typeof imports.$inferSelect,
): ActionableProductOption[] => parseImportWarningsPayload(record.warnings).actionable;

export const findActionableOptionForImport = (
  record: typeof imports.$inferSelect,
  requestId: string,
): ActionableProductOption | null =>
  listActionableProductsForImport(record).find((option) => option.requestId === requestId) ?? null;

export const loadStillActionableProductsForImport = async (
  record: typeof imports.$inferSelect,
): Promise<ActionableProductOption[]> => {
  const options = listActionableProductsForImport(record);
  if (options.length === 0) {
    return [];
  }

  const db = getDb();
  const rows = await db
    .select({
      id: shotRequests.id,
      productSku: shotRequests.productSku,
      workflowStatus: shotRequests.workflowStatus,
    })
    .from(shotRequests)
    .where(
      inArray(
        shotRequests.id,
        options.map((option) => option.requestId),
      ),
    );

  return filterActionableOptionsByStatus(
    options,
    new Map(rows.map((row) => [row.id, row])),
  );
};

export const getRequestStatusSummary = async () => {
  const db = getDb();
  const rows = await db.select().from(shotRequests);
  const byStatus = new Map<string, number>();

  for (const row of rows) {
    byStatus.set(row.workflowStatus, (byStatus.get(row.workflowStatus) ?? 0) + 1);
  }

  return {
    totalRequests: rows.length,
    byStatus,
  };
};

export const importRecordToSummary = (
  record: typeof imports.$inferSelect,
): RequestPlanSummary => {
  const payload = parseImportWarningsPayload(record.warnings);
  const priorityOption = record.priorityRequestSku
    ? payload.actionable.find((option) => option.sku === record.priorityRequestSku)
    : undefined;

  return {
    importId: record.id,
    totalCatalogRows: record.totalCatalogRows,
    rowsWithShotIdea: record.rowsWithShotIdea,
    newRequests: record.newRequests,
    changedRequests: record.changedRequests,
    unchangedExistingRequests: record.unchangedExistingRequests,
    existingPendingRequests: record.existingPendingRequests,
    requestsReadyToGenerate: record.requestsReadyToGenerate,
    plannedGenerations: record.plannedGenerations,
    additionalEstimatedCostMicrosUsd: record.additionalEstimatedCostMicrosUsd,
    warnings: payload.warnings,
    actionableProducts: payload.actionable,
    priorityRequestSku: record.priorityRequestSku,
    priorityRequestPriority: priorityOption?.priority ?? null,
  };
};

/** Test helper: remove rows created by integration tests. */
export const deleteImportArtifacts = async (importId: string, skus: string[]) => {
  const db = getDb();
  const requestRows = await db
    .select({ id: shotRequests.id })
    .from(shotRequests)
    .where(eq(shotRequests.importId, importId));
  const requestIds = requestRows.map((row) => row.id);
  if (requestIds.length > 0) {
    await db.delete(generationCandidates).where(inArray(generationCandidates.shotRequestId, requestIds));
  }
  await db.delete(shotRequests).where(eq(shotRequests.importId, importId));
  if (skus.length > 0) {
    await db.delete(products).where(inArray(products.sku, skus));
  }
  await db.delete(imports).where(eq(imports.id, importId));
};

export const countImportsByExternalEvent = async (
  platform: ChatPlatform,
  externalEventId: string,
): Promise<number> => {
  const db = getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(imports)
    .where(
      and(eq(imports.platform, platform), eq(imports.externalEventId, externalEventId)),
    );

  return rows[0]?.count ?? 0;
};
