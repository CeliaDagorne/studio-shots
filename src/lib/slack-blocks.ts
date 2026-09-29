import {
  buildImportPreviewText,
  formatPriorityRequestPreviewLine,
  formatUsdMicros,
  hasActionableGenerations,
  IMPORT_UP_TO_DATE_MESSAGE,
  MVP_ASPECT_RATIO,
} from "@/lib/request-planning";
import type { RequestPlanSummary } from "@/types";

export type SlackBlock = Record<string, unknown>;

/**
 * Block Kit preview for a catalog import. Content mirrors buildImportPreviewText
 * using the shared RequestPlanSummary — no separate planning logic.
 */
export const buildSlackImportPreviewBlocks = (
  summary: RequestPlanSummary,
  options?: { campaignPageUrl?: string | null },
): SlackBlock[] => {
  const warningText =
    summary.warnings.length === 0
      ? "_None_"
      : summary.warnings
          .slice(0, 6)
          .map((warning) => `• *${warning.sku}*: ${warning.message}`)
          .join("\n");

  const actionableText =
    summary.actionableProducts.length === 0
      ? "_None_"
      : summary.actionableProducts
          .slice(0, 12)
          .map((product) => `• *${product.sku}* (${product.priority})`)
          .join("\n");

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Catalog import preview", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Total catalog rows*\n${summary.totalCatalogRows}` },
        { type: "mrkdwn", text: `*Rows with Shot Idea*\n${summary.rowsWithShotIdea}` },
        { type: "mrkdwn", text: `*New requests*\n${summary.newRequests}` },
        { type: "mrkdwn", text: `*Changed requests*\n${summary.changedRequests}` },
        {
          type: "mrkdwn",
          text: `*Unchanged existing*\n${summary.unchangedExistingRequests}`,
        },
        {
          type: "mrkdwn",
          text: `*Existing pending*\n${summary.existingPendingRequests}`,
        },
        {
          type: "mrkdwn",
          text: `*Ready to generate*\n${summary.requestsReadyToGenerate}`,
        },
        {
          type: "mrkdwn",
          text: `*Planned generations*\n${summary.plannedGenerations}`,
        },
      ],
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Estimated generation cost*\n${formatUsdMicros(summary.additionalEstimatedCostMicrosUsd)}`,
        },
        { type: "mrkdwn", text: `*Aspect ratio*\n${MVP_ASPECT_RATIO}` },
        {
          type: "mrkdwn",
          text: `*Priority product*\n${
            summary.priorityRequestSku
              ? `${summary.priorityRequestSku}${
                  summary.priorityRequestPriority
                    ? ` (${summary.priorityRequestPriority})`
                    : ""
                }`
              : "None detected"
          }`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Actionable products*\n${actionableText}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Catalog-level warnings*\n${warningText}`,
      },
    },
  ];

  if (options?.campaignPageUrl) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Campaign overview*\n<${options.campaignPageUrl}|Open campaign page>`,
      },
    });
  }

  if (!hasActionableGenerations(summary)) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: IMPORT_UP_TO_DATE_MESSAGE }],
    });
  } else {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${formatPriorityRequestPreviewLine(summary)}. Product selection and generation in Slack are coming next — Telegram remains fully supported.`,
        },
      ],
    });
  }

  return blocks;
};

export const buildSlackImportPreviewFallbackText = (
  summary: RequestPlanSummary,
  options?: { campaignPageUrl?: string | null },
): string => buildImportPreviewText(summary, options);
