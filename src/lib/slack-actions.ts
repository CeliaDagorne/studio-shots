import { buildCampaignPageUrl } from "@/lib/campaigns";
import { CHAT_PLATFORM, slackConversation } from "@/lib/chat-identity";
import { env } from "@/lib/env";
import {
  getCandidateById,
  getShotRequestById,
  persistCandidateReview,
  runPriorityGeneration,
  runSelectedRequestGeneration,
} from "@/lib/generation";
import { notifyConversation } from "@/lib/generation-delivery";
import {
  getImportById,
  importRecordToSummary,
  listActionableProductsForImport,
  loadStillActionableProductsForImport,
} from "@/lib/imports";
import {
  buildProductPageUrl,
  formatApprovalCompletionMessage,
} from "@/lib/products";
import {
  evaluateProductSelection,
  selectionErrorMessage,
} from "@/lib/product-selection";
import { formatGenerationStartedLine } from "@/lib/request-planning";
import { CANDIDATE_STATUS, PRIORITY_CANDIDATE_COUNT, REVIEW_DECISION, WORKFLOW } from "@/lib/review";
import type { GenerationCandidateRow, ImportRow, ShotRequestRow } from "@/lib/schema";
import { isAllowedSlackChannel, isAllowedSlackTeam } from "@/lib/slack";
import {
  buildSlackCancelledPreviewBlocks,
  buildSlackCandidateBlocks,
  buildSlackGenerationStartedBlocks,
  buildSlackImportPreviewBlocks,
  buildSlackImportPreviewFallbackText,
  buildSlackProductPickerBlocks,
  finalizeSlackCandidateMessageBlocks,
  parseSlackGenValue,
  parseSlackPageValue,
  SLACK_ACTION_IDS,
  type SlackBlock,
} from "@/lib/slack-blocks";
import { claimSlackEventId, releaseSlackEventId } from "@/lib/slack-dedupe";
import type { ActionableProductOption } from "@/types";

const postSlackResponseUrl = async (
  responseUrl: string,
  body: SlackInteractionResponse,
): Promise<void> => {
  const response = await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Slack response_url HTTP ${response.status}`);
  }
};

const reviewedMessageResponse = (
  decision: "approved" | "rejected",
  sourceBlocks: SlackBlock[] | undefined,
): SlackInteractionResponse => {
  const text = decision === "approved" ? "Status: Approved" : "Status: Rejected";
  if (sourceBlocks && sourceBlocks.length > 0) {
    return {
      replace_original: true,
      text,
      blocks: finalizeSlackCandidateMessageBlocks(sourceBlocks, decision),
    };
  }
  return {
    replace_original: true,
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: decision === "approved" ? "*Status: Approved*" : "*Status: Rejected*",
        },
      },
    ],
  };
};

export type SlackBlockAction = {
  action_id: string;
  block_id?: string;
  value?: string;
  action_ts?: string;
};

export type SlackInteractionPayload = {
  type: string;
  trigger_id?: string;
  team?: { id?: string };
  channel?: { id?: string };
  user?: { id?: string };
  message?: {
    ts?: string;
    text?: string;
    blocks?: SlackBlock[];
  };
  response_url?: string;
  actions?: SlackBlockAction[];
};

export type SlackInteractionResponse = {
  replace_original?: boolean;
  delete_original?: boolean;
  response_type?: "ephemeral" | "in_channel";
  text: string;
  blocks?: SlackBlock[];
};

export type SlackInteractionHandleResult = {
  httpBody: SlackInteractionResponse;
  background?: () => Promise<void>;
};

export type SlackActionDeps = {
  getImportById?: (importId: string) => Promise<ImportRow | null>;
  listActionableProductsForImport?: (record: ImportRow) => ActionableProductOption[];
  loadStillActionableProductsForImport?: (
    record: ImportRow,
  ) => Promise<ActionableProductOption[]>;
  getShotRequestById?: (
    shotRequestId: string,
  ) => Promise<Pick<ShotRequestRow, "id" | "productSku" | "workflowStatus"> | null>;
  getCandidateById?: (candidateId: string) => Promise<GenerationCandidateRow | null>;
  persistCandidateReview?: typeof persistCandidateReview;
  runPriorityGeneration?: typeof runPriorityGeneration;
  runSelectedRequestGeneration?: typeof runSelectedRequestGeneration;
  notifyConversation?: typeof notifyConversation;
  claimAction?: typeof claimSlackEventId;
  releaseAction?: typeof releaseSlackEventId;
  postResponseUrl?: typeof postSlackResponseUrl;
  appUrl?: string;
  isAllowedTeam?: (teamId: string) => boolean;
  isAllowedChannel?: (channelId: string) => boolean;
};

export const SLACK_INTERACTION_MESSAGES = {
  unauthorizedWorkspace: "Studio Shots is not enabled for this workspace.",
  unauthorizedChannel: "Studio Shots is not enabled in this channel.",
  unknownAction: "That action is not supported.",
  staleImport: "That import preview is no longer available.",
  wrongConversation: "That import does not belong to this channel.",
  duplicateAction: "That action was already handled.",
  noPriority: "No priority product is available to generate.",
  cancelled: "Cancelled. No generation was started.",
  missingCandidate: "That candidate could not be found.",
  staleCandidate: "That candidate is no longer available for review.",
  wrongCandidateConversation: "That candidate does not belong to this channel.",
  alreadyApproved: "This candidate was already approved.",
  alreadyRejected: "This candidate was already rejected.",
  conflictingDecision: "This candidate already has a different review decision.",
  reviewInProgress: "That review is already being recorded.",
} as const;

/** Extract the JSON `payload` field from Slack's form-encoded interaction body. */
export const parseSlackInteractionFormBody = (rawBody: string): SlackInteractionPayload => {
  const params = new URLSearchParams(rawBody);
  const encoded = params.get("payload");
  if (!encoded) {
    throw new Error("missing_payload");
  }
  const parsed = JSON.parse(encoded) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid_payload");
  }
  return parsed as SlackInteractionPayload;
};

const ephemeral = (text: string): SlackInteractionResponse => ({
  response_type: "ephemeral",
  text,
});

/**
 * Handle a verified Slack block_actions interaction.
 * Returns an immediate message update/ephemeral body and optional background work.
 */
export const handleSlackBlockAction = async (
  payload: SlackInteractionPayload,
  deps: SlackActionDeps = {},
): Promise<SlackInteractionHandleResult> => {
  const getImport = deps.getImportById ?? getImportById;
  const listActionable = deps.listActionableProductsForImport ?? listActionableProductsForImport;
  const loadStillActionable =
    deps.loadStillActionableProductsForImport ?? loadStillActionableProductsForImport;
  const getShotRequest = deps.getShotRequestById ?? getShotRequestById;
  const getCandidate = deps.getCandidateById ?? getCandidateById;
  const persistReview = deps.persistCandidateReview ?? persistCandidateReview;
  const runPriority = deps.runPriorityGeneration ?? runPriorityGeneration;
  const runSelected = deps.runSelectedRequestGeneration ?? runSelectedRequestGeneration;
  const notify = deps.notifyConversation ?? notifyConversation;
  const claimAction = deps.claimAction ?? claimSlackEventId;
  const releaseAction = deps.releaseAction ?? releaseSlackEventId;
  const postResponseUrl = deps.postResponseUrl ?? postSlackResponseUrl;
  const appUrl = deps.appUrl ?? env.appUrl;
  const allowTeam = deps.isAllowedTeam ?? isAllowedSlackTeam;
  const allowChannel = deps.isAllowedChannel ?? isAllowedSlackChannel;

  const teamId = payload.team?.id;
  const channelId = payload.channel?.id;
  const action = payload.actions?.[0];

  if (!teamId || !allowTeam(teamId)) {
    return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.unauthorizedWorkspace) };
  }
  if (!channelId || !allowChannel(channelId)) {
    return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.unauthorizedChannel) };
  }
  if (!action?.action_id || typeof action.value !== "string") {
    return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.unknownAction) };
  }

  if (payload.type !== "block_actions") {
    return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.unknownAction) };
  }

  const dedupeKey =
    payload.trigger_id ?? `${action.action_id}:${action.value}:${action.action_ts ?? ""}`;
  if (!claimAction(`slack-action:${dedupeKey}`)) {
    return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.duplicateAction) };
  }

  const conversation = slackConversation(channelId);
  const campaignUrlFor = (importId: string) => buildCampaignPageUrl(appUrl, importId);

  const loadAuthorizedImport = async (importId: string) => {
    const record = await getImport(importId);
    if (!record) {
      return { ok: false as const, message: SLACK_INTERACTION_MESSAGES.staleImport };
    }
    if (record.platform !== CHAT_PLATFORM.slack) {
      return { ok: false as const, message: SLACK_INTERACTION_MESSAGES.staleImport };
    }
    if (record.conversationId !== channelId) {
      return { ok: false as const, message: SLACK_INTERACTION_MESSAGES.wrongConversation };
    }
    return { ok: true as const, record };
  };

  if (action.action_id === SLACK_ACTION_IDS.cancel) {
    const loaded = await loadAuthorizedImport(action.value);
    if (!loaded.ok) {
      return { httpBody: ephemeral(loaded.message) };
    }
    const summary = importRecordToSummary(loaded.record);
    const campaignPageUrl = campaignUrlFor(loaded.record.id);
    return {
      httpBody: {
        replace_original: true,
        text: `${buildSlackImportPreviewFallbackText(summary, { campaignPageUrl })}\n\nCancelled.`,
        blocks: buildSlackCancelledPreviewBlocks(summary, { campaignPageUrl }),
      },
    };
  }

  if (action.action_id === SLACK_ACTION_IDS.choose) {
    const loaded = await loadAuthorizedImport(action.value);
    if (!loaded.ok) {
      return { httpBody: ephemeral(loaded.message) };
    }
    const actionable = await loadStillActionable(loaded.record);
    if (actionable.length === 0) {
      return { httpBody: ephemeral(selectionErrorMessage("unavailable")) };
    }
    const picker = buildSlackProductPickerBlocks({
      importId: loaded.record.id,
      products: actionable,
      page: 0,
    });
    return {
      httpBody: {
        replace_original: true,
        text: picker.text,
        blocks: picker.blocks,
      },
    };
  }

  if (action.action_id === SLACK_ACTION_IDS.page) {
    const parsed = parseSlackPageValue(action.value);
    if (!parsed) {
      return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.unknownAction) };
    }
    const loaded = await loadAuthorizedImport(parsed.importId);
    if (!loaded.ok) {
      return { httpBody: ephemeral(loaded.message) };
    }
    const actionable = await loadStillActionable(loaded.record);
    const picker = buildSlackProductPickerBlocks({
      importId: loaded.record.id,
      products: actionable,
      page: parsed.page,
    });
    return {
      httpBody: {
        replace_original: true,
        text: picker.text,
        blocks: picker.blocks,
      },
    };
  }

  if (action.action_id === SLACK_ACTION_IDS.back) {
    const loaded = await loadAuthorizedImport(action.value);
    if (!loaded.ok) {
      return { httpBody: ephemeral(loaded.message) };
    }
    const summary = importRecordToSummary(loaded.record);
    const campaignPageUrl = campaignUrlFor(loaded.record.id);
    return {
      httpBody: {
        replace_original: true,
        text: buildSlackImportPreviewFallbackText(summary, { campaignPageUrl }),
        blocks: buildSlackImportPreviewBlocks(summary, { campaignPageUrl }),
      },
    };
  }

  if (action.action_id === SLACK_ACTION_IDS.priority) {
    const loaded = await loadAuthorizedImport(action.value);
    if (!loaded.ok) {
      return { httpBody: ephemeral(loaded.message) };
    }
    const prioritySku = loaded.record.priorityRequestSku;
    if (!prioritySku) {
      return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.noPriority) };
    }

    const stillActionable = await loadStillActionable(loaded.record);
    const priorityOption = stillActionable.find((option) => option.sku === prioritySku);
    if (!priorityOption) {
      return { httpBody: ephemeral(selectionErrorMessage("unavailable")) };
    }

    const summary = importRecordToSummary(loaded.record);
    const campaignPageUrl = campaignUrlFor(loaded.record.id);
    const label = `priority product ${prioritySku}`;

    return {
      httpBody: {
        replace_original: true,
        text: `${buildSlackImportPreviewFallbackText(summary, { campaignPageUrl })}\n\n${formatGenerationStartedLine(label)}`,
        blocks: buildSlackGenerationStartedBlocks(summary, label, { campaignPageUrl }),
      },
      background: async () => {
        await runPriority({
          importId: loaded.record.id,
          conversation,
        });
      },
    };
  }

  if (action.action_id === SLACK_ACTION_IDS.gen) {
    const parsed = parseSlackGenValue(action.value);
    if (!parsed) {
      return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.unknownAction) };
    }

    const loaded = await loadAuthorizedImport(parsed.importId);
    if (!loaded.ok) {
      return { httpBody: ephemeral(loaded.message) };
    }

    const actionable = listActionable(loaded.record);
    const request = await getShotRequest(parsed.requestId);
    const evaluation = evaluateProductSelection({
      actionable,
      requestId: parsed.requestId,
      request: request
        ? {
            id: request.id,
            productSku: request.productSku,
            workflowStatus: request.workflowStatus,
          }
        : null,
    });

    if (!evaluation.ok) {
      return { httpBody: ephemeral(selectionErrorMessage(evaluation.reason)) };
    }

    if (evaluation.option.sku !== parsed.sku) {
      return { httpBody: ephemeral(selectionErrorMessage("mismatch")) };
    }

    const summary = importRecordToSummary(loaded.record);
    const campaignPageUrl = campaignUrlFor(loaded.record.id);
    const label = `${evaluation.option.sku} (${evaluation.option.priority})`;

    return {
      httpBody: {
        replace_original: true,
        text: `${buildSlackImportPreviewFallbackText(summary, { campaignPageUrl })}\n\n${formatGenerationStartedLine(label)}`,
        blocks: buildSlackGenerationStartedBlocks(summary, label, { campaignPageUrl }),
      },
      background: async () => {
        await runSelected({
          shotRequestId: evaluation.option.requestId,
          conversation,
        });
      },
    };
  }

  if (
    action.action_id === SLACK_ACTION_IDS.approve ||
    action.action_id === SLACK_ACTION_IDS.reject
  ) {
    const decision =
      action.action_id === SLACK_ACTION_IDS.approve ? "approved" : "rejected";
    const candidateId = action.value;
    const reviewClaimKey = `slack-review:${candidateId}`;

    // Claim before responding so a second Approve/Reject cannot stay clickable while
    // the first click's spinner is still showing.
    if (!claimAction(reviewClaimKey)) {
      return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.reviewInProgress) };
    }

    const sourceBlocks = Array.isArray(payload.message?.blocks)
      ? payload.message.blocks
      : undefined;
    const httpBody = reviewedMessageResponse(decision, sourceBlocks);
    const responseUrl = payload.response_url;

    return {
      httpBody,
      background: async () => {
        try {
          const candidate = await getCandidate(candidateId);

          const postEphemeral = async (text: string) => {
            if (!responseUrl) return;
            await postResponseUrl(responseUrl, ephemeral(text));
          };

          const postCandidateMessage = async (
            row: GenerationCandidateRow,
            reviewDecision: string,
          ) => {
            if (!responseUrl || !row.blobUrl) return;
            const built = buildSlackCandidateBlocks({
              caption: "",
              blobUrl: row.blobUrl,
              candidateId: row.id,
              sku: row.productSku,
              candidateIndex: row.candidateIndex,
              total: PRIORITY_CANDIDATE_COUNT,
              reviewDecision,
            });
            await postResponseUrl(responseUrl, {
              replace_original: true,
              text: built.text,
              blocks: built.blocks,
            });
          };

          if (!candidate) {
            await postEphemeral(SLACK_INTERACTION_MESSAGES.missingCandidate);
            return;
          }
          if (candidate.platform !== CHAT_PLATFORM.slack) {
            await postEphemeral(SLACK_INTERACTION_MESSAGES.staleCandidate);
            return;
          }
          if (candidate.conversationId !== channelId) {
            await postEphemeral(SLACK_INTERACTION_MESSAGES.wrongCandidateConversation);
            return;
          }
          if (candidate.status !== CANDIDATE_STATUS.ready || !candidate.blobUrl) {
            await postEphemeral(SLACK_INTERACTION_MESSAGES.staleCandidate);
            return;
          }

          const messageTs = payload.message?.ts;
          if (
            candidate.externalMessageId &&
            messageTs &&
            candidate.externalMessageId !== messageTs
          ) {
            await postEphemeral(SLACK_INTERACTION_MESSAGES.staleCandidate);
            return;
          }

          if (candidate.reviewDecision) {
            await postCandidateMessage(candidate, candidate.reviewDecision);
            if (candidate.reviewDecision !== decision) {
              await postEphemeral(
                candidate.reviewDecision === REVIEW_DECISION.approved
                  ? SLACK_INTERACTION_MESSAGES.alreadyApproved
                  : candidate.reviewDecision === REVIEW_DECISION.rejected
                    ? SLACK_INTERACTION_MESSAGES.alreadyRejected
                    : SLACK_INTERACTION_MESSAGES.conflictingDecision,
              );
            }
            return;
          }

          const persisted = await persistReview({
            candidateId: candidate.id,
            decision,
          });

          if (
            persisted.alreadyReviewed &&
            persisted.existingDecision &&
            persisted.existingDecision !== decision
          ) {
            console.error(
              "[slack/review]",
              `candidate ${candidate.id} already ${persisted.existingDecision}; ignored ${decision}`,
            );
            await postCandidateMessage(candidate, persisted.existingDecision);
            await postEphemeral(
              persisted.existingDecision === REVIEW_DECISION.approved
                ? SLACK_INTERACTION_MESSAGES.alreadyApproved
                : persisted.existingDecision === REVIEW_DECISION.rejected
                  ? SLACK_INTERACTION_MESSAGES.alreadyRejected
                  : SLACK_INTERACTION_MESSAGES.conflictingDecision,
            );
            return;
          }

          // Re-post via response_url so buttons stay gone even if Slack ignored
          // the HTTP replace_original acknowledgement.
          const finalDecision =
            persisted.existingDecision ?? decision;
          await postCandidateMessage(
            persisted.candidate ?? candidate,
            finalDecision,
          );

          if (!persisted.newlyResolved || !persisted.requestStatus) {
            return;
          }

          if (
            persisted.requestStatus === WORKFLOW.approved &&
            persisted.approvedCount !== null &&
            persisted.candidate
          ) {
            await notify(
              conversation,
              formatApprovalCompletionMessage({
                sku: persisted.candidate.productSku,
                approvedCount: persisted.approvedCount,
                productPageUrl: buildProductPageUrl(
                  appUrl,
                  persisted.candidate.productSku,
                ),
                campaignPageUrl: persisted.importId
                  ? buildCampaignPageUrl(appUrl, persisted.importId)
                  : null,
              }),
            );
          } else if (
            persisted.requestStatus === WORKFLOW.needsRegeneration &&
            persisted.candidate
          ) {
            await notify(
              conversation,
              `${persisted.candidate.productSku} needs regeneration (${persisted.approvedCount ?? 0} approvals; need at least 2).`,
            );
          }
        } finally {
          releaseAction(reviewClaimKey);
        }
      },
    };
  }

  return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.unknownAction) };
};
