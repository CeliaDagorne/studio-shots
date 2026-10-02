import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { resolvePublicAssetUrl } from "@/lib/assets";
import { runCandidateImagePipeline } from "@/lib/candidate-pipeline";
import { buildCampaignPageUrl } from "@/lib/campaigns";
import {
  type ChatConversation,
  CHAT_PLATFORM,
  parseTelegramMessageId,
  requireTelegramConversation,
} from "@/lib/chat-identity";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import {
  deriveStatusFromCandidates,
  stableGenerationAttemptId,
} from "@/lib/generation-attempts";
import { deliverCandidateImage, notifyConversation } from "@/lib/generation-delivery";
import { parseImportWarningsPayload } from "@/lib/import-meta";
import { getImageGenerationProvider } from "@/lib/image-generation-provider";
import { isFakeImageGenerationProvider } from "@/lib/image-generation";
import { buildImageEditPrompt } from "@/lib/luma";
import {
  buildProductPageUrl,
  formatApprovalCompletionMessage,
} from "@/lib/products";
import {
  CANDIDATE_STATUS,
  displayCandidateIndexInAttempt,
  filterLatestGenerationAttempt,
  generationAttemptId,
  generationAttemptNumber,
  MIN_APPROVALS_TO_COMPLETE,
  nextGenerationAttemptStartIndex,
  PRIORITY_CANDIDATE_COUNT,
  REVIEW_DECISION,
  WORKFLOW,
  candidateCaption,
  resolveRequestAfterReviews,
} from "@/lib/review";
import { MVP_ASPECT_RATIO } from "@/lib/request-planning";
import {
  generationAttempts,
  generationCandidates,
  imports,
  products,
  shotRequests,
} from "@/lib/schema";
import {
  buildSlackCandidatesReadyBlocks,
  buildSlackDeliveryFailedBlocks,
  buildSlackGenerationFailedBlocks,
} from "@/lib/slack-blocks";
import {
  editMessageCaption,
  removeInlineKeyboard,
  sendMessage,
} from "@/lib/telegram";

const now = () => new Date();

const CLAIMABLE_WORKFLOW_STATUSES = [
  WORKFLOW.importedUnconfirmed,
  WORKFLOW.failed,
  WORKFLOW.needsRegeneration,
] as const;

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

/**
 * Atomically claim a request for generation/retry/regenerate.
 * Only one concurrent claim succeeds — duplicate Retry clicks are idempotent.
 */
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
        inArray(shotRequests.workflowStatus, [...CLAIMABLE_WORKFLOW_STATUSES]),
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
          inArray(shotRequests.workflowStatus, [...CLAIMABLE_WORKFLOW_STATUSES]),
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
        inArray(shotRequests.workflowStatus, [...CLAIMABLE_WORKFLOW_STATUSES]),
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
  candidateIndex: number;
  productSku: string;
  photoUrl: string;
  prompt: string;
}): Promise<"ready" | "failed"> => {
  const db = getDb();
  const baseProvider = getImageGenerationProvider();
  const provider = {
    ...baseProvider,
    createGeneration: async (
      input: Parameters<typeof baseProvider.createGeneration>[0],
    ) => {
      const created = await baseProvider.createGeneration(input);
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
  };

  const result = await runCandidateImagePipeline(provider, params);

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

/**
 * Re-poll stored external generation IDs so a timeout cannot spawn duplicate paid work.
 * Recovers candidates in place when Luma (or fake) reports completed.
 */
export const reconcileExternalGenerationIds = async (params: {
  candidates: Array<{
    id: string;
    productSku: string;
    status: string;
    lumaGenerationId: string | null;
    blobUrl: string | null;
  }>;
}): Promise<number> => {
  const db = getDb();
  const provider = getImageGenerationProvider();
  let recovered = 0;

  for (const candidate of params.candidates) {
    if (
      !candidate.lumaGenerationId ||
      candidate.status === CANDIDATE_STATUS.ready ||
      candidate.blobUrl
    ) {
      continue;
    }

    try {
      const finished = await provider.pollUntilDone(candidate.lumaGenerationId);
      if (finished.state !== "completed" || !finished.outputUrl) {
        await db
          .update(generationCandidates)
          .set({
            lumaState: finished.state,
            status: CANDIDATE_STATUS.failed,
            errorMessage: finished.failureReason ?? "Image generation failed",
            updatedAt: now(),
          })
          .where(eq(generationCandidates.id, candidate.id));
        continue;
      }

      const stored = await provider.storeCandidateImage({
        sourceUrl: finished.outputUrl,
        sku: candidate.productSku,
        candidateId: candidate.id,
      });

      await db
        .update(generationCandidates)
        .set({
          lumaState: finished.state,
          status: CANDIDATE_STATUS.ready,
          blobPath: stored.blobPath,
          blobUrl: stored.blobUrl,
          errorMessage: null,
          updatedAt: now(),
        })
        .where(eq(generationCandidates.id, candidate.id));
      recovered += 1;
    } catch (error) {
      console.error(
        "[generation/reconcile]",
        candidate.id,
        error instanceof Error ? error.message : "reconcile failed",
      );
    }
  }

  return recovered;
};

const deliverReadyCandidates = async (params: {
  conversation: ChatConversation;
  candidates: Array<{
    id: string;
    productSku: string;
    candidateIndex: number;
    blobUrl: string | null;
    externalMessageId: string | null;
  }>;
  /** When true, only candidates missing an external message id are posted. */
  onlyUndelivered?: boolean;
}): Promise<{ delivered: number; failed: number }> => {
  const db = getDb();
  let delivered = 0;
  let failed = 0;

  for (const candidate of params.candidates) {
    if (!candidate.blobUrl) continue;
    if (params.onlyUndelivered && candidate.externalMessageId) continue;

    const displayIndex = displayCandidateIndexInAttempt(candidate.candidateIndex);
    try {
      const result = await deliverCandidateImage({
        conversation: params.conversation,
        blobUrl: candidate.blobUrl,
        caption: candidateCaption({
          sku: candidate.productSku,
          index: displayIndex,
          total: PRIORITY_CANDIDATE_COUNT,
        }),
        candidateId: candidate.id,
        sku: candidate.productSku,
        candidateIndex: displayIndex,
      });
      if (result.externalMessageId) {
        await db
          .update(generationCandidates)
          .set({
            externalMessageId: result.externalMessageId,
            updatedAt: now(),
          })
          .where(eq(generationCandidates.id, candidate.id));
        delivered += 1;
      } else {
        failed += 1;
        if (result.deliveryError) {
          console.error(
            "[generation/slack-delivery]",
            candidate.id,
            result.deliveryError,
          );
        }
      }
    } catch (error) {
      failed += 1;
      console.error(
        "[generation/slack-delivery]",
        candidate.id,
        error instanceof Error ? error.message : "delivery failed",
      );
    }
  }

  return { delivered, failed };
};

const notifyGenerationFailed = async (params: {
  conversation: ChatConversation;
  sku: string;
  requestId: string;
  importId: string | null;
  detail?: string;
}) => {
  if (params.conversation.platform === CHAT_PLATFORM.slack && params.importId) {
    const campaignPageUrl = buildCampaignPageUrl(env.appUrl, params.importId);
    const built = buildSlackGenerationFailedBlocks({
      sku: params.sku,
      importId: params.importId,
      requestId: params.requestId,
      campaignPageUrl,
      testMode: isFakeImageGenerationProvider(),
    });
    await notifyConversation(params.conversation, built.text, { blocks: built.blocks });
    return;
  }

  await notifyConversation(
    params.conversation,
    `⚠️ Generation failed for ${params.sku}${params.detail ? `: ${params.detail}` : ""}`,
  );
};

const notifyDeliveryFailed = async (params: {
  conversation: ChatConversation;
  sku: string;
  requestId: string;
  importId: string | null;
  readyCount: number;
}) => {
  if (params.conversation.platform === CHAT_PLATFORM.slack && params.importId) {
    const campaignPageUrl = buildCampaignPageUrl(env.appUrl, params.importId);
    const built = buildSlackDeliveryFailedBlocks({
      sku: params.sku,
      importId: params.importId,
      requestId: params.requestId,
      readyCount: params.readyCount,
      campaignPageUrl,
      testMode: isFakeImageGenerationProvider(),
    });
    await notifyConversation(params.conversation, built.text, { blocks: built.blocks });
    return;
  }

  await notifyConversation(
    params.conversation,
    `Could not deliver review controls for ${params.sku}. ${params.readyCount} candidate(s) are ready. Ask to resend without regenerating.`,
  );
};

/**
 * Re-deliver ready candidates that lack Slack/Telegram message ids.
 * Never creates a new generation or charges Luma.
 */
export const redeliverReadyCandidates = async (params: {
  shotRequestId: string;
  conversation: ChatConversation;
}): Promise<{ ok: boolean; delivered: number; reason?: string }> => {
  const db = getDb();
  const request = await getShotRequestById(params.shotRequestId);
  if (!request) {
    return { ok: false, delivered: 0, reason: "missing_request" };
  }

  const all = await db
    .select()
    .from(generationCandidates)
    .where(eq(generationCandidates.shotRequestId, params.shotRequestId))
    .orderBy(asc(generationCandidates.candidateIndex));

  const latest = filterLatestGenerationAttempt(all);
  const ready = latest.filter(
    (candidate) => candidate.status === CANDIDATE_STATUS.ready && candidate.blobUrl,
  );

  if (ready.length === 0) {
    return { ok: false, delivered: 0, reason: "no_ready_candidates" };
  }

  const result = await deliverReadyCandidates({
    conversation: params.conversation,
    candidates: ready,
    onlyUndelivered: true,
  });

  if (request.workflowStatus !== WORKFLOW.awaitingReview) {
    await markRequestStatus(params.shotRequestId, WORKFLOW.awaitingReview);
  }

  if (result.failed > 0 && result.delivered === 0) {
    await notifyDeliveryFailed({
      conversation: params.conversation,
      sku: request.productSku,
      requestId: request.id,
      importId: request.importId,
      readyCount: ready.length,
    });
  }

  return { ok: true, delivered: result.delivered };
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
      "That product is no longer available to generate. It may already be generating, complete, or cancelled.",
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

    const prompt = buildImageEditPrompt({
      shotIdea: claimedRequest.shotIdea,
    });

    const existing = await db
      .select()
      .from(generationCandidates)
      .where(eq(generationCandidates.shotRequestId, shotRequestId))
      .orderBy(asc(generationCandidates.candidateIndex));

    const latest = filterLatestGenerationAttempt(existing);
    const latestReady = latest.filter((c) => c.status === CANDIDATE_STATUS.ready);
    const latestFullyReviewed =
      latestReady.length > 0 && latestReady.every((c) => Boolean(c.reviewDecision));

    // Uncertain prior failure: reconcile stored external IDs before paying again.
    if (!latestFullyReviewed && latest.some((c) => c.lumaGenerationId)) {
      await reconcileExternalGenerationIds({ candidates: latest });
      const afterReconcile = filterLatestGenerationAttempt(
        await db
          .select()
          .from(generationCandidates)
          .where(eq(generationCandidates.shotRequestId, shotRequestId))
          .orderBy(asc(generationCandidates.candidateIndex)),
      );
      const recoveredReady = afterReconcile.filter(
        (c) => c.status === CANDIDATE_STATUS.ready && c.blobUrl,
      );
      if (recoveredReady.length > 0) {
        const delivery = await deliverReadyCandidates({
          conversation: params.conversation,
          candidates: recoveredReady,
        });
        await markRequestStatus(shotRequestId, WORKFLOW.awaitingReview);
        if (delivery.failed > 0) {
          await notifyDeliveryFailed({
            conversation: params.conversation,
            sku: claimedRequest.productSku,
            requestId: shotRequestId,
            importId: claimedRequest.importId,
            readyCount: recoveredReady.length,
          });
        } else if (params.conversation.platform === CHAT_PLATFORM.slack) {
          const readyMessage = buildSlackCandidatesReadyBlocks({
            sku: claimedRequest.productSku,
            candidateCount: recoveredReady.length,
            approvalThreshold: MIN_APPROVALS_TO_COMPLETE,
            testMode: isFakeImageGenerationProvider(),
          });
          await notifyConversation(params.conversation, readyMessage.text, {
            blocks: readyMessage.blocks,
          });
        }
        return { claimed: true };
      }
    }

    const startIndex = nextGenerationAttemptStartIndex(existing);
    const attemptLabel = generationAttemptId(startIndex);
    const attemptNumber = generationAttemptNumber(startIndex);
    const attemptRowId = stableGenerationAttemptId(shotRequestId, attemptNumber);
    const environment = isFakeImageGenerationProvider() ? "test" : "luma";
    const attemptCreatedAt = now();

    await db.insert(generationAttempts).values({
      id: attemptRowId,
      shotRequestId,
      productSku: claimedRequest.productSku,
      attemptNumber,
      isLegacy: false,
      shotIdea: claimedRequest.shotIdea,
      aspectRatio: MVP_ASPECT_RATIO,
      environment,
      status: "generating",
      createdAt: attemptCreatedAt,
      updatedAt: attemptCreatedAt,
    });

    const candidateRows = Array.from({ length: PRIORITY_CANDIDATE_COUNT }, (_, index) => {
      const candidateIndex = startIndex + index;
      return {
        id: stableCandidateId(shotRequestId, candidateIndex),
        shotRequestId,
        generationAttemptId: attemptRowId,
        productSku: claimedRequest.productSku,
        candidateIndex,
        status: CANDIDATE_STATUS.pending,
        prompt,
        platform: params.conversation.platform,
        conversationId: params.conversation.conversationId,
      };
    });

    console.info(
      "[generation/attempt]",
      shotRequestId,
      attemptLabel,
      attemptRowId,
      `indices ${startIndex}-${startIndex + PRIORITY_CANDIDATE_COUNT - 1}`,
    );

    for (const row of candidateRows) {
      await db.insert(generationCandidates).values(row);
    }

    if (params.conversation.platform !== CHAT_PLATFORM.slack) {
      await notifyConversation(
        params.conversation,
        `Generating 3 ${claimedRequest.productSku} lifestyle candidates from the catalog product photo (~$0.13). I'll send each photo when ready.`,
      );
    }

    await Promise.all(
      candidateRows.map((row) =>
        processOneCandidate({
          candidateId: row.id,
          candidateIndex: row.candidateIndex,
          productSku: row.productSku,
          photoUrl: resolvePublicAssetUrl(product.photoUrl, env.appUrl),
          prompt,
        }),
      ),
    );

    const attemptCandidates = await db
      .select()
      .from(generationCandidates)
      .where(
        and(
          eq(generationCandidates.shotRequestId, shotRequestId),
          inArray(
            generationCandidates.candidateIndex,
            candidateRows.map((row) => row.candidateIndex),
          ),
        ),
      )
      .orderBy(asc(generationCandidates.candidateIndex));

    const ready = attemptCandidates.filter(
      (candidate) => candidate.status === CANDIDATE_STATUS.ready,
    );
    const failed = attemptCandidates.filter(
      (candidate) => candidate.status === CANDIDATE_STATUS.failed,
    );

    const attemptStatus = deriveStatusFromCandidates(attemptCandidates);
    await db
      .update(generationAttempts)
      .set({
        status: attemptStatus,
        errorMessage: failed[0]?.errorMessage ?? null,
        updatedAt: now(),
      })
      .where(eq(generationAttempts.id, attemptRowId));

    if (ready.length === 0) {
      await markRequestStatus(shotRequestId, WORKFLOW.failed);
      await notifyGenerationFailed({
        conversation: params.conversation,
        sku: claimedRequest.productSku,
        requestId: shotRequestId,
        importId: claimedRequest.importId,
        detail: failed[0]?.errorMessage
          ? `all ${PRIORITY_CANDIDATE_COUNT} candidates failed. First error: ${failed[0].errorMessage}`
          : `all ${PRIORITY_CANDIDATE_COUNT} candidates failed.`,
      });
      return { claimed: true };
    }

    const delivery = await deliverReadyCandidates({
      conversation: params.conversation,
      candidates: ready,
    });

    await markRequestStatus(shotRequestId, WORKFLOW.awaitingReview);

    if (delivery.failed > 0) {
      await notifyDeliveryFailed({
        conversation: params.conversation,
        sku: claimedRequest.productSku,
        requestId: shotRequestId,
        importId: claimedRequest.importId,
        readyCount: ready.length,
      });
      return { claimed: true };
    }

    try {
      if (failed.length > 0) {
        await notifyConversation(
          params.conversation,
          `${claimedRequest.productSku}: ${ready.length} candidate(s) ready for review, ${failed.length} failed. Review the photos above; the request will resolve after every available candidate is approved or rejected.`,
        );
      } else if (params.conversation.platform === CHAT_PLATFORM.slack) {
        const readyMessage = buildSlackCandidatesReadyBlocks({
          sku: claimedRequest.productSku,
          candidateCount: ready.length,
          approvalThreshold: MIN_APPROVALS_TO_COMPLETE,
          testMode: isFakeImageGenerationProvider(),
        });
        await notifyConversation(params.conversation, readyMessage.text, {
          blocks: readyMessage.blocks,
        });
      } else {
        await notifyConversation(
          params.conversation,
          `${claimedRequest.productSku}: all ${ready.length} candidates are ready. Approve or reject each photo. Done requires at least 2 approvals.`,
        );
      }
    } catch (error) {
      console.error(
        "[generation/slack-notify]",
        error instanceof Error ? error.message : "ready notification failed",
      );
    }
    return { claimed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown generation failure";
    // Slack presentation failures after candidates are ready should not wipe generation.
    if (/Slack chat\.postMessage failed/i.test(message)) {
      console.error("[generation/slack-presentation]", message);
      const db = getDb();
      const readyCount = await db
        .select({ id: generationCandidates.id })
        .from(generationCandidates)
        .where(
          and(
            eq(generationCandidates.shotRequestId, shotRequestId),
            eq(generationCandidates.status, CANDIDATE_STATUS.ready),
          ),
        );
      if (readyCount.length > 0) {
        await markRequestStatus(shotRequestId, WORKFLOW.awaitingReview);
        await notifyDeliveryFailed({
          conversation: params.conversation,
          sku: claimedRequest.productSku,
          requestId: shotRequestId,
          importId: claimedRequest.importId,
          readyCount: readyCount.length,
        });
        return { claimed: true };
      }
    }
    await ensureRequestLeavesGenerating(shotRequestId, WORKFLOW.failed);
    await notifyGenerationFailed({
      conversation: params.conversation,
      sku: label,
      requestId: shotRequestId,
      importId: claimedRequest.importId,
      detail: message,
    });
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
      "Priority generation was skipped. No actionable priority request, or it was already claimed.",
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
