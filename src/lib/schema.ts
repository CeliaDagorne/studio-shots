import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const products = pgTable("products", {
  sku: text("sku").primaryKey(),
  productName: text("product_name").notNull(),
  category: text("category").notNull(),
  colorOrFinish: text("color_or_finish").notNull(),
  material: text("material").notNull(),
  priceCents: integer("price_cents").notNull(),
  photoUrl: text("photo_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const imports = pgTable("imports", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  totalCatalogRows: integer("total_catalog_rows").notNull(),
  rowsWithShotIdea: integer("rows_with_shot_idea").notNull(),
  newRequests: integer("new_requests").notNull(),
  changedRequests: integer("changed_requests").notNull(),
  unchangedExistingRequests: integer("unchanged_existing_requests").notNull(),
  existingPendingRequests: integer("existing_pending_requests").notNull(),
  requestsReadyToGenerate: integer("requests_ready_to_generate").notNull(),
  plannedGenerations: integer("planned_generations").notNull(),
  additionalEstimatedCostMicrosUsd: integer("additional_estimated_cost_micros_usd").notNull(),
  warnings: jsonb("warnings").notNull(),
  priorityRequestSku: text("priority_request_sku"),
  platform: text("platform").notNull(),
  conversationId: text("conversation_id").notNull(),
  externalEventId: text("external_event_id").notNull(),
  previewMessageId: text("preview_message_id"),
  confirmationAction: text("confirmation_action"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  previewMessageIdx: uniqueIndex("imports_preview_message_idx").on(
    table.platform,
    table.conversationId,
    table.previewMessageId,
  ),
  platformExternalEventIdx: uniqueIndex("imports_platform_external_event_idx").on(
    table.platform,
    table.externalEventId,
  ),
}));

export const shotRequests = pgTable("shot_requests", {
  id: text("id").primaryKey(),
  productSku: text("product_sku").notNull().references(() => products.sku),
  importId: text("import_id").references(() => imports.id),
  supersedesRequestId: text("supersedes_request_id"),
  shotIdea: text("shot_idea").notNull(),
  notesSnapshot: text("notes_snapshot"),
  requestHash: text("request_hash").notNull(),
  workflowStatus: text("workflow_status").notNull(),
  approvedCount: integer("approved_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  skuHashIdx: uniqueIndex("shot_requests_sku_hash_idx").on(table.productSku, table.requestHash),
}));

export const generationAttempts = pgTable("generation_attempts", {
  id: text("id").primaryKey(),
  shotRequestId: text("shot_request_id")
    .notNull()
    .references(() => shotRequests.id),
  productSku: text("product_sku").notNull().references(() => products.sku),
  /** 1-based attempt within the request; null for legacy buckets. */
  attemptNumber: integer("attempt_number"),
  isLegacy: boolean("is_legacy").default(false).notNull(),
  shotIdea: text("shot_idea").notNull(),
  aspectRatio: text("aspect_ratio").notNull(),
  environment: text("environment"),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const generationCandidates = pgTable("generation_candidates", {
  id: text("id").primaryKey(),
  shotRequestId: text("shot_request_id")
    .notNull()
    .references(() => shotRequests.id),
  generationAttemptId: text("generation_attempt_id").references(() => generationAttempts.id),
  productSku: text("product_sku").notNull().references(() => products.sku),
  candidateIndex: integer("candidate_index").notNull(),
  lumaGenerationId: text("luma_generation_id"),
  lumaState: text("luma_state"),
  status: text("status").notNull(),
  reviewDecision: text("review_decision"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  blobPath: text("blob_path"),
  blobUrl: text("blob_url"),
  prompt: text("prompt").notNull(),
  errorMessage: text("error_message"),
  platform: text("platform"),
  conversationId: text("conversation_id"),
  externalMessageId: text("external_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  requestIndexIdx: uniqueIndex("generation_candidates_request_index_idx").on(
    table.shotRequestId,
    table.candidateIndex,
  ),
}));

export type ProductRow = typeof products.$inferSelect;
export type ShotRequestRow = typeof shotRequests.$inferSelect;
export type ImportRow = typeof imports.$inferSelect;
export type GenerationAttemptRow = typeof generationAttempts.$inferSelect;
export type GenerationCandidateRow = typeof generationCandidates.$inferSelect;
