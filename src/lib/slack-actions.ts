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
  parseSlackGenValue,
  parseSlackPageValue,
  SLACK_ACTION_IDS,
  type SlackBlock,
} from "@/lib/slack-blocks";
import { claimSlackEventId } from "@/lib/slack-dedupe";
import type { ActionableProductOption } from "@/types";

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
  message?: { ts?: string; text?: string };
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
    const candidate = await getCandidate(candidateId);

    if (!candidate) {
      return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.missingCandidate) };
    }
    if (candidate.platform !== CHAT_PLATFORM.slack) {
      return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.staleCandidate) };
    }
    if (candidate.conversationId !== channelId) {
      return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.wrongCandidateConversation) };
    }
    if (candidate.status !== CANDIDATE_STATUS.ready || !candidate.blobUrl) {
      return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.staleCandidate) };
    }

    const messageTs = payload.message?.ts;
    if (
      candidate.externalMessageId &&
      messageTs &&
      candidate.externalMessageId !== messageTs
    ) {
      return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.staleCandidate) };
    }

    if (candidate.reviewDecision) {
      if (candidate.reviewDecision === decision) {
        const built = buildSlackCandidateBlocks({
          caption: "",
          blobUrl: candidate.blobUrl,
          candidateId: candidate.id,
          sku: candidate.productSku,
          candidateIndex: candidate.candidateIndex,
          total: PRIORITY_CANDIDATE_COUNT,
          reviewDecision: candidate.reviewDecision,
        });
        return {
          httpBody: {
            replace_original: true,
            text: built.text,
            blocks: built.blocks,
          },
        };
      }
      return {
        httpBody: ephemeral(
          candidate.reviewDecision === REVIEW_DECISION.approved
            ? SLACK_INTERACTION_MESSAGES.alreadyApproved
            : candidate.reviewDecision === REVIEW_DECISION.rejected
              ? SLACK_INTERACTION_MESSAGES.alreadyRejected
              : SLACK_INTERACTION_MESSAGES.conflictingDecision,
        ),
      };
    }

    const persisted = await persistReview({
      candidateId: candidate.id,
      decision,
    });

    if (!persisted.candidate?.blobUrl) {
      return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.missingCandidate) };
    }

    if (
      persisted.alreadyReviewed &&
      persisted.existingDecision &&
      persisted.existingDecision !== decision
    ) {
      return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.conflictingDecision) };
    }

    const finalDecision = persisted.candidate.reviewDecision ?? decision;
    const built = buildSlackCandidateBlocks({
      caption: "",
      blobUrl: persisted.candidate.blobUrl,
      candidateId: persisted.candidate.id,
      sku: persisted.candidate.productSku,
      candidateIndex: persisted.candidate.candidateIndex,
      total: PRIORITY_CANDIDATE_COUNT,
      reviewDecision: finalDecision,
    });

    return {
      httpBody: {
        replace_original: true,
        text: built.text,
        blocks: built.blocks,
      },
      background:
        persisted.newlyResolved && persisted.requestStatus
          ? async () => {
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
            }
          : undefined,
    };
  }

  return { httpBody: ephemeral(SLACK_INTERACTION_MESSAGES.unknownAction) };
};
