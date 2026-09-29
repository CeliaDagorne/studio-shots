import {
  buildImportPreviewText,
  estimatedCostMicrosForOneProduct,
  formatPriorityRequestPreviewLine,
  formatProductPickerButtonText,
  formatUsdMicros,
  hasActionableGenerations,
  IMPORT_UP_TO_DATE_MESSAGE,
  MVP_ASPECT_RATIO,
} from "@/lib/request-planning";
import { candidateCaption } from "@/lib/review";
import type { ActionableProductOption, RequestPlanSummary } from "@/types";

export type SlackBlock = Record<string, unknown>;

export const SLACK_PRODUCT_PICKER_PAGE_SIZE = 6;

export const SLACK_ACTION_IDS = {
  priority: "ss_imp_priority",
  choose: "ss_imp_choose",
  cancel: "ss_imp_cancel",
  gen: "ss_imp_gen",
  page: "ss_imp_page",
  back: "ss_imp_back",
  approve: "ss_cand_approve",
  reject: "ss_cand_reject",
} as const;

const VALUE_SEP = "::";

export const encodeSlackImportValue = (importId: string): string => importId;

export const encodeSlackPageValue = (importId: string, page: number): string =>
  `${importId}${VALUE_SEP}${page}`;

export const encodeSlackGenValue = (
  importId: string,
  requestId: string,
  sku: string,
): string => `${importId}${VALUE_SEP}${requestId}${VALUE_SEP}${sku}`;

export const parseSlackPageValue = (
  value: string,
): { importId: string; page: number } | null => {
  const idx = value.lastIndexOf(VALUE_SEP);
  if (idx <= 0) return null;
  const importId = value.slice(0, idx);
  const page = Number.parseInt(value.slice(idx + VALUE_SEP.length), 10);
  if (!importId || !Number.isFinite(page) || page < 0) return null;
  return { importId, page };
};

export const parseSlackGenValue = (
  value: string,
): { importId: string; requestId: string; sku: string } | null => {
  const parts = value.split(VALUE_SEP);
  if (parts.length !== 3) return null;
  const [importId, requestId, sku] = parts;
  if (!importId || !requestId || !sku) return null;
  return { importId, requestId, sku };
};

const button = (params: {
  actionId: string;
  text: string;
  value: string;
  style?: "primary" | "danger";
}) => ({
  type: "button",
  action_id: params.actionId,
  text: { type: "plain_text", text: params.text.slice(0, 75), emoji: true },
  value: params.value,
  ...(params.style ? { style: params.style } : {}),
});

export const buildSlackImportActionElements = (
  summary: RequestPlanSummary,
): SlackBlock[] => {
  if (!hasActionableGenerations(summary)) {
    return [];
  }

  const priorityLabel = summary.priorityRequestSku
    ? `Generate priority: ${summary.priorityRequestSku}`
    : "Generate priority";

  return [
    {
      type: "actions",
      block_id: `ss_imp_actions:${summary.importId}`,
      elements: [
        button({
          actionId: SLACK_ACTION_IDS.priority,
          text: priorityLabel,
          value: encodeSlackImportValue(summary.importId),
          style: "primary",
        }),
        button({
          actionId: SLACK_ACTION_IDS.choose,
          text: "Choose a product",
          value: encodeSlackImportValue(summary.importId),
        }),
        button({
          actionId: SLACK_ACTION_IDS.cancel,
          text: "Cancel",
          value: encodeSlackImportValue(summary.importId),
          style: "danger",
        }),
      ],
    },
  ];
};

/**
 * Block Kit preview for a catalog import. Content mirrors buildImportPreviewText
 * using the shared RequestPlanSummary — no separate planning logic.
 */
export const buildSlackImportPreviewBlocks = (
  summary: RequestPlanSummary,
  options?: { campaignPageUrl?: string | null; includeActions?: boolean },
): SlackBlock[] => {
  const includeActions = options?.includeActions !== false;
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
          text: `${formatPriorityRequestPreviewLine(summary)}. Choose priority generation or pick any actionable SKU.`,
        },
      ],
    });
    if (includeActions) {
      blocks.push(...buildSlackImportActionElements(summary));
    }
  }

  return blocks;
};

export const buildSlackImportPreviewFallbackText = (
  summary: RequestPlanSummary,
  options?: { campaignPageUrl?: string | null },
): string => buildImportPreviewText(summary, options);

export const buildSlackProductPickerBlocks = (params: {
  importId: string;
  products: ActionableProductOption[];
  page: number;
  pageSize?: number;
}): { text: string; blocks: SlackBlock[] } => {
  const pageSize = params.pageSize ?? SLACK_PRODUCT_PICKER_PAGE_SIZE;
  const total = params.products.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(params.page, 0), totalPages - 1);
  const start = safePage * pageSize;
  const pageItems = params.products.slice(start, start + pageSize);
  const cost = formatUsdMicros(estimatedCostMicrosForOneProduct());

  const text = [
    "Choose a product to generate",
    "",
    `Actionable products: ${total}`,
    `Estimated cost per product: ${cost} (3 candidates)`,
    `Page ${safePage + 1} of ${totalPages}`,
  ].join("\n");

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Choose a product", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Actionable products:* ${total}\n*Estimated cost per product:* ${cost} (3 candidates)\n*Page ${safePage + 1} of ${totalPages}*`,
      },
    },
  ];

  for (const option of pageItems) {
    blocks.push({
      type: "actions",
      block_id: `ss_imp_gen:${option.requestId}`,
      elements: [
        button({
          actionId: SLACK_ACTION_IDS.gen,
          text: formatProductPickerButtonText(option),
          value: encodeSlackGenValue(params.importId, option.requestId, option.sku),
        }),
      ],
    });
  }

  const navElements = [];
  if (safePage > 0) {
    navElements.push(
      button({
        actionId: SLACK_ACTION_IDS.page,
        text: "Previous",
        value: encodeSlackPageValue(params.importId, safePage - 1),
      }),
    );
  }
  if (safePage < totalPages - 1) {
    navElements.push(
      button({
        actionId: SLACK_ACTION_IDS.page,
        text: "Next",
        value: encodeSlackPageValue(params.importId, safePage + 1),
      }),
    );
  }
  if (navElements.length > 0) {
    blocks.push({
      type: "actions",
      block_id: `ss_imp_nav:${params.importId}`,
      elements: navElements,
    });
  }

  blocks.push({
    type: "actions",
    block_id: `ss_imp_picker_footer:${params.importId}`,
    elements: [
      button({
        actionId: SLACK_ACTION_IDS.back,
        text: "Back",
        value: encodeSlackImportValue(params.importId),
      }),
      button({
        actionId: SLACK_ACTION_IDS.cancel,
        text: "Cancel",
        value: encodeSlackImportValue(params.importId),
        style: "danger",
      }),
    ],
  });

  return { text, blocks };
};

export const buildSlackCancelledPreviewBlocks = (
  summary: RequestPlanSummary,
  options?: { campaignPageUrl?: string | null },
): SlackBlock[] => [
  ...buildSlackImportPreviewBlocks(summary, {
    ...options,
    includeActions: false,
  }),
  {
    type: "context",
    elements: [{ type: "mrkdwn", text: "*Cancelled.* No generation was started." }],
  },
];

export const buildSlackGenerationStartedBlocks = (
  summary: RequestPlanSummary,
  label: string,
  options?: { campaignPageUrl?: string | null },
): SlackBlock[] => [
  ...buildSlackImportPreviewBlocks(summary, {
    ...options,
    includeActions: false,
  }),
  {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `*Confirmed:* generating ${label} in the background.`,
      },
    ],
  },
];

export const encodeSlackCandidateValue = (candidateId: string): string => candidateId;

export const buildSlackCandidateBlocks = (params: {
  caption: string;
  blobUrl: string;
  candidateId: string;
  sku: string;
  candidateIndex: number;
  total: number;
  reviewDecision?: string | null;
}): { text: string; blocks: SlackBlock[] } => {
  const statusLine =
    params.reviewDecision === "approved"
      ? "*Status: Approved*"
      : params.reviewDecision === "rejected"
        ? "*Status: Rejected*"
        : "Review this candidate independently.";

  const text =
    params.reviewDecision === "approved" || params.reviewDecision === "rejected"
      ? candidateCaption({
          sku: params.sku,
          index: params.candidateIndex,
          total: params.total,
          reviewDecision: params.reviewDecision,
        })
      : params.caption;

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${params.sku}* · candidate ${params.candidateIndex}/${params.total}\n${statusLine}`,
      },
    },
    {
      type: "image",
      image_url: params.blobUrl,
      alt_text: `${params.sku} candidate ${params.candidateIndex}`,
    },
  ];

  if (!params.reviewDecision) {
    blocks.push({
      type: "actions",
      block_id: `ss_cand_actions:${params.candidateId}`,
      elements: [
        button({
          actionId: SLACK_ACTION_IDS.approve,
          text: "Approve",
          value: encodeSlackCandidateValue(params.candidateId),
          style: "primary",
        }),
        button({
          actionId: SLACK_ACTION_IDS.reject,
          text: "Reject",
          value: encodeSlackCandidateValue(params.candidateId),
          style: "danger",
        }),
      ],
    });
  }

  return { text, blocks };
};
