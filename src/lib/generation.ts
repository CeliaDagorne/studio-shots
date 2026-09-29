import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";

import { resolvePublicAssetUrl } from "@/lib/assets";
import { downloadAndStoreCandidateImage } from "@/lib/blob";
import { runCandidateImagePipeline } from "@/lib/candidate-pipeline";
import { buildCampaignPageUrl } from "@/lib/campaigns";
import {
  type ChatConversation,
  parseTelegramMessageId,
  requireTelegramConversation,
} from "@/lib/chat-identity";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { deliverCandidateImage, notifyConversation } from "@/lib/generation-delivery";
import { parseImportWarningsPayload } from "@/lib/import-meta";
import {
  buildImageRefPrompt,
  createImageRefGeneration,
  pollGenerationUntilDone,
} from "@/lib/luma";
import {
  buildProductPageUrl,
  formatApprovalCompletionMessage,
} from "@/lib/products";
import {
  CANDIDATE_STATUS,
  PRIORITY_CANDIDATE_COUNT,
  REVIEW_DECISION,
  WORKFLOW,
  candidateCaption,
  resolveRequestAfterReviews,
} from "@/lib/review";
import { generationCandidates, imports, products, shotRequests } from "@/lib/schema";
import {
  editMessageCaption,
  removeInlineKeyboard,
  sendMessage,
} from "@/lib/telegram";

const now = () => new Date();

const hashToUuid = (hex: string): string =>
  [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");

export const stableCandidateId = (shotRequestId: string, index: number): string =>
  hashToUuid(
    createHash("sha256").update(`candidate:${shotRequestId}:${index}`).digest("hex"),
  );

export const claimShotRequestForGeneration = async (shotRequestId: string) => {
  const db = getDb();
  const claimed = await db
    .update(shotRequests)
    .set({
      workflowStatus: WORKFLOW.generating,
      updatedAt: now(),
    })
    .where(
      and(
        eq(shotRequests.id, shotRequestId),
        eq(shotRequests.workflowStatus, WORKFLOW.importedUnconfirmed),
      ),
    )
    .returning();

  return claimed[0] ?? null;
};

export const findActionablePriorityRequest = async (importId: string) => {
  const db = getDb();
  const importRows = await db.select().from(imports).where(eq(imports.id, importId)).limit(1);
  const importRecord = importRows[0];
  if (!importRecord?.priorityRequestSku) {
    return null;
  }

  const { parseImportWarningsPayload } = await import("@/lib/import-meta");
  const payload = parseImportWarningsPayload(importRecord.warnings);
  const priorityOption = payload.actionable.find(
    (option) => option.sku === importRecord.priorityRequestSku,
  );

  if (priorityOption) {
    const byId = await db
      .select()
      .from(shotRequests)
      .where(
        and(
          eq(shotRequests.id, priorityOption.requestId),
          eq(shotRequests.workflowStatus, WORKFLOW.importedUnconfirmed),
        ),
      )
      .limit(1);
    if (byId[0]) {
      return byId[0];
    }
  }

  const rows = await db
    .select()
    .from(shotRequests)
    .where(
      and(
        eq(shotRequests.productSku, importRecord.priorityRequestSku),
        eq(shotRequests.workflowStatus, WORKFLOW.importedUnconfirmed),
      ),
    )
    .orderBy(asc(shotRequests.createdAt))
    .limit(1);

  return rows[0] ?? null;
};

export const getShotRequestById = async (shotRequestId: string) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(shotRequests)
    .where(eq(shotRequests.id, shotRequestId))
    .limit(1);
  return rows[0] ?? null;
};

export const getCandidateById = async (candidateId: string) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(generationCandidates)
    .where(eq(generationCandidates.id, candidateId))
    .limit(1);
  return rows[0] ?? null;
};

const markRequestStatus = async (shotRequestId: string, workflowStatus: string, approvedCount?: number) => {
  const db = getDb();
  await db
    .update(shotRequests)
    .set({
      workflowStatus,
      ...(typeof approvedCount === "number" ? { approvedCount } : {}),
      updatedAt: now(),
    })
    .where(eq(shotRequests.id, shotRequestId));
};

const ensureRequestLeavesGenerating = async (shotRequestId: string, fallbackStatus: string) => {
  const db = getDb();
  await db
    .update(shotRequests)
    .set({
      workflowStatus: fallbackStatus,
      updatedAt: now(),
    })
    .where(
      and(
        eq(shotRequests.id, shotRequestId),
        eq(shotRequests.workflowStatus, WORKFLOW.generating),
      ),
    );
};

const processOneCandidate = async (params: {
  candidateId: string;
  productSku: string;
  photoUrl: string;
  prompt: string;
}): Promise<"ready" | "failed"> => {
  const db = getDb();

  const result = await runCandidateImagePipeline(
    {
      createImageRefGeneration: async (input) => {
        const created = await createImageRefGeneration(input);
        await db
          .update(generationCandidates)
          .set({
            lumaGenerationId: created.id,
            lumaState: created.state,
            status: CANDIDATE_STATUS.submitted,
            updatedAt: now(),
          })
          .where(eq(generationCandidates.id, params.candidateId));
        return created;
      },
      pollGenerationUntilDone,
      downloadAndStoreCandidateImage,
    },
    params,
  );

  if (result.status === "ready") {
    await db
      .update(generationCandidates)
      .set({
        lumaGenerationId: result.lumaGenerationId,
        lumaState: result.lumaState,
        status: CANDIDATE_STATUS.ready,
        blobPath: result.blobPath,
        blobUrl: result.blobUrl,
        updatedAt: now(),
      })
      .where(eq(generationCandidates.id, params.candidateId));
    return "ready";
  }

  await db
    .update(generationCandidates)
    .set({
      lumaGenerationId: result.lumaGenerationId ?? null,
      lumaState: result.lumaState ?? null,
      status: CANDIDATE_STATUS.failed,
      errorMessage: result.errorMessage,
      updatedAt: now(),
    })
    .where(eq(generationCandidates.id, params.candidateId));
  return "failed";
};

export const runShotRequestGeneration = async (params: {
  shotRequestId: string;
  conversation: ChatConversation;
  label?: string;
}): Promise<{ claimed: boolean }> => {
  const claimedRequest = await claimShotRequestForGeneration(params.shotRequestId);

  if (!claimedRequest) {
    await notifyConversation(
      params.conversation,
      "That product is no longer available to generate — it may already be generating, complete, or cancelled.",
    );
    return { claimed: false };
  }

  const shotRequestId = claimedRequest.id;
  const label = params.label ?? claimedRequest.productSku;

  try {
    const db = getDb();
    const productRows = await db
      .select()
      .from(products)
      .where(eq(products.sku, claimedRequest.productSku))
      .limit(1);
    const product = productRows[0];
    if (!product) {
      throw new Error(`Product ${claimedRequest.productSku} not found`);
    }

    const prompt = buildImageRefPrompt({
      productName: product.productName,
      colorOrFinish: product.colorOrFinish,
      material: product.material,
      shotIdea: claimedRequest.shotIdea,
    });

    const candidateRows = Array.from({ length: PRIORITY_CANDIDATE_COUNT }, (_, index) => {
      const candidateIndex = index + 1;
      return {
        id: stableCandidateId(shotRequestId, candidateIndex),
        shotRequestId,
        productSku: claimedRequest.productSku,
        candidateIndex,
        status: CANDIDATE_STATUS.pending,
        prompt,
        platform: params.conversation.platform,
        conversationId: params.conversation.conversationId,
      };
    });

    for (const row of candidateRows) {
      await db.insert(generationCandidates).values(row);
    }

    await notifyConversation(
      params.conversation,
      `Generating 3 ${claimedRequest.productSku} candidates with image_ref at 3:2 (~$0.13). I'll send each photo when ready.`,
    );

    await Promise.all(
      candidateRows.map((row) =>
        processOneCandidate({
          candidateId: row.id,
          productSku: row.productSku,
          photoUrl: resolvePublicAssetUrl(product.photoUrl, env.appUrl),
          prompt,
        }),
      ),
    );

    const readyCandidates = await db
      .select()
      .from(generationCandidates)
      .where(eq(generationCandidates.shotRequestId, shotRequestId))
      .orderBy(asc(generationCandidates.candidateIndex));

    const ready = readyCandidates.filter((candidate) => candidate.status === CANDIDATE_STATUS.ready);
    const failed = readyCandidates.filter((candidate) => candidate.status === CANDIDATE_STATUS.failed);

    for (const candidate of ready) {
      if (!candidate.blobUrl) continue;
      const delivered = await deliverCandidateImage({
        conversation: params.conversation,
        blobUrl: candidate.blobUrl,
        caption: candidateCaption({
          sku: candidate.productSku,
          index: candidate.candidateIndex,
          total: PRIORITY_CANDIDATE_COUNT,
        }),
        candidateId: candidate.id,
        sku: candidate.productSku,
        candidateIndex: candidate.candidateIndex,
      });
      if (delivered.externalMessageId) {
        await db
          .update(generationCandidates)
          .set({
            externalMessageId: delivered.externalMessageId,
            updatedAt: now(),
          })
          .where(eq(generationCandidates.id, candidate.id));
      }
    }

    if (ready.length === 0) {
      await markRequestStatus(shotRequestId, WORKFLOW.failed);
      await notifyConversation(
        params.conversation,
        `Generation failed for ${claimedRequest.productSku}: all ${PRIORITY_CANDIDATE_COUNT} candidates failed.${
          failed[0]?.errorMessage ? ` First error: ${failed[0].errorMessage}` : ""
        }`,
      );
      return { claimed: true };
    }

    await markRequestStatus(shotRequestId, WORKFLOW.awaitingReview);

    if (failed.length > 0) {
      await notifyConversation(
        params.conversation,
        `${claimedRequest.productSku}: ${ready.length} candidate(s) ready for review, ${failed.length} failed. Review the photos above; the request will resolve after every available candidate is approved or rejected.`,
      );
    } else {
      await notifyConversation(
        params.conversation,
        `${claimedRequest.productSku}: all ${ready.length} candidates are ready. Approve or reject each photo. Done requires at least 2 approvals.`,
      );
    }
    return { claimed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown generation failure";
    await ensureRequestLeavesGenerating(shotRequestId, WORKFLOW.failed);
    await notifyConversation(
      params.conversation,
      `Generation crashed for ${label} (request ${shotRequestId}): ${message}`,
    );
    return { claimed: true };
  }
};

export const runPriorityGeneration = async (params: {
  importId: string;
  conversation: ChatConversation;
}): Promise<void> => {
  const request = await findActionablePriorityRequest(params.importId);
  if (!request) {
    await notifyConversation(
      params.conversation,
      "Priority generation was skipped — no actionable priority request, or it was already claimed.",
    );
    return;
  }

  await runShotRequestGeneration({
    shotRequestId: request.id,
    conversation: params.conversation,
    label: `priority ${request.productSku}`,
  });
};

export const runSelectedRequestGeneration = async (params: {
  shotRequestId: string;
  conversation: ChatConversation;
}): Promise<void> => {
  await runShotRequestGeneration({
    shotRequestId: params.shotRequestId,
    conversation: params.conversation,
  });
};

export type PersistCandidateReviewResult = {
  alreadyReviewed: boolean;
  candidate: typeof generationCandidates.$inferSelect | null;
  existingDecision: string | null;
  requestStatus: string | null;
  approvedCount: number | null;
  importId: string | null;
  /** True when this call newly recorded a decision and advanced the request. */
  newlyResolved: boolean;
};

/**
 * Shared approve/reject persistence used by Telegram and Slack.
 * Atomic on `review_decision IS NULL` so duplicate clicks stay idempotent.
 */
export const persistCandidateReview = async (params: {
  candidateId: string;
  decision: "approved" | "rejected";
}): Promise<PersistCandidateReviewResult> => {
  const db = getDb();
  const decision =
    params.decision === "approved" ? REVIEW_DECISION.approved : REVIEW_DECISION.rejected;

  const updated = await db
    .update(generationCandidates)
    .set({
      reviewDecision: decision,
      reviewedAt: now(),
      updatedAt: now(),
    })
    .where(
      and(
        eq(generationCandidates.id, params.candidateId),
        sql`${generationCandidates.reviewDecision} IS NULL`,
      ),
    )
    .returning();

  const candidate =
    updated[0] ??
    (
      await db
        .select()
        .from(generationCandidates)
        .where(eq(generationCandidates.id, params.candidateId))
        .limit(1)
    )[0];

  if (!candidate) {
    return {
      alreadyReviewed: true,
      candidate: null,
      existingDecision: null,
      requestStatus: null,
      approvedCount: null,
      importId: null,
      newlyResolved: false,
    };
  }

  const alreadyReviewed = updated.length === 0;
  const existingDecision = candidate.reviewDecision ?? null;

  const siblings = await db
    .select()
    .from(generationCandidates)
    .where(eq(generationCandidates.shotRequestId, candidate.shotRequestId));

  const resolution = resolveRequestAfterReviews(siblings);

  if (alreadyReviewed) {
    return {
      alreadyReviewed: true,
      candidate,
      existingDecision,
      requestStatus: resolution.status,
      approvedCount:
        resolution.status === WORKFLOW.awaitingReview ? null : resolution.approvedCount,
      importId: null,
      newlyResolved: false,
    };
  }

  if (resolution.status === WORKFLOW.awaitingReview) {
    return {
      alreadyReviewed: false,
      candidate,
      existingDecision: decision,
      requestStatus: WORKFLOW.awaitingReview,
      approvedCount: null,
      importId: null,
      newlyResolved: false,
    };
  }

  await markRequestStatus(
    candidate.shotRequestId,
    resolution.status,
    resolution.approvedCount,
  );

  const requestRows = await db
    .select({ importId: shotRequests.importId })
    .from(shotRequests)
    .where(eq(shotRequests.id, candidate.shotRequestId))
    .limit(1);

  return {
    alreadyReviewed: false,
    candidate,
    existingDecision: decision,
    requestStatus: resolution.status,
    approvedCount: resolution.approvedCount,
    importId: requestRows[0]?.importId ?? null,
    newlyResolved: true,
  };
};

export const applyCandidateReview = async (params: {
  candidateId: string;
  decision: "approved" | "rejected";
  conversation: ChatConversation;
  externalMessageId: string;
}): Promise<{ alreadyReviewed: boolean; requestStatus: string | null }> => {
  const chatId = requireTelegramConversation(params.conversation);
  const messageId = parseTelegramMessageId(params.externalMessageId);

  const persisted = await persistCandidateReview({
    candidateId: params.candidateId,
    decision: params.decision,
  });

  if (!persisted.candidate) {
    return { alreadyReviewed: true, requestStatus: null };
  }

  const displayDecision =
    persisted.candidate.reviewDecision ??
    (params.decision === "approved" ? REVIEW_DECISION.approved : REVIEW_DECISION.rejected);

  await editMessageCaption(
    chatId,
    messageId,
    candidateCaption({
      sku: persisted.candidate.productSku,
      index: persisted.candidate.candidateIndex,
      total: PRIORITY_CANDIDATE_COUNT,
      reviewDecision: displayDecision,
    }),
    removeInlineKeyboard(),
  );

  if (persisted.alreadyReviewed || !persisted.newlyResolved || !persisted.requestStatus) {
    return {
      alreadyReviewed: persisted.alreadyReviewed,
      requestStatus: persisted.requestStatus,
    };
  }

  if (persisted.requestStatus === WORKFLOW.approved && persisted.approvedCount !== null) {
    await sendMessage(
      chatId,
      formatApprovalCompletionMessage({
        sku: persisted.candidate.productSku,
        approvedCount: persisted.approvedCount,
        productPageUrl: buildProductPageUrl(env.appUrl, persisted.candidate.productSku),
        campaignPageUrl: persisted.importId
          ? buildCampaignPageUrl(env.appUrl, persisted.importId)
          : null,
      }),
    );
  } else if (persisted.requestStatus === WORKFLOW.needsRegeneration) {
    await sendMessage(
      chatId,
      `${persisted.candidate.productSku} needs regeneration (${persisted.approvedCount ?? 0} approvals; need at least 2).`,
    );
  }

  return {
    alreadyReviewed: false,
    requestStatus: persisted.requestStatus,
  };
};
