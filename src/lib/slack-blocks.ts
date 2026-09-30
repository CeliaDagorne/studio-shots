import {
  CANDIDATES_PER_REQUEST,
  estimatedCostMicrosForOneProduct,
  formatOneProductCostLabel,
  formatPriorityGenerateButtonText,
  formatProductPickerButtonText,
  formatUsdMicros,
  hasActionableGenerations,
  IMPORT_UP_TO_DATE_MESSAGE,
  MVP_ASPECT_RATIO,
} from "@/lib/request-planning";
import { candidateCaption } from "@/lib/review";
import type { ActionableProductOption, RequestPlanSummary } from "@/types";

export type SlackBlock = Record<string, unknown>;

/** Slack allows at most 5 `actions` blocks and 5 buttons per block in a message. */
export const SLACK_MAX_ACTIONS_BLOCKS_PER_MESSAGE = 5;
export const SLACK_MAX_BUTTONS_PER_ACTIONS_BLOCK = 5;

export const SLACK_PRODUCT_PICKER_PAGE_SIZE = 6;

export const SLACK_GENERATION_MODE = "image_ref";

export const countSlackActionBlocks = (blocks: SlackBlock[]): number =>
  blocks.filter((block) => block.type === "actions").length;

const chunkSlackPickerProducts = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

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
  actionId?: string;
  text: string;
  value?: string;
  url?: string;
  style?: "primary" | "danger";
}) => ({
  type: "button",
  ...(params.actionId ? { action_id: params.actionId } : {}),
  text: { type: "plain_text", text: params.text.slice(0, 75), emoji: true },
  ...(params.value ? { value: params.value } : {}),
  ...(params.url ? { url: params.url } : {}),
  ...(params.style ? { style: params.style } : {}),
});

const field = (label: string, value: string) => ({
  type: "mrkdwn",
  text: `*${label}*\n${value}`,
});

const formatPriorityProductLabel = (summary: RequestPlanSummary): string => {
  if (!summary.priorityRequestSku) {
    return "None detected";
  }
  return summary.priorityRequestPriority
    ? `${summary.priorityRequestSku} (${summary.priorityRequestPriority})`
    : summary.priorityRequestSku;
};

const formatImportDetailsContextLine = (summary: RequestPlanSummary): string =>
  [
    `${summary.totalCatalogRows} rows`,
    `${summary.newRequests} new`,
    `${summary.changedRequests} changed`,
    `${summary.unchangedExistingRequests} unchanged`,
    `${summary.existingPendingRequests} pending`,
  ].join(" · ");

export const buildSlackImportActionElements = (
  summary: RequestPlanSummary,
  options?: { campaignPageUrl?: string | null },
): SlackBlock[] => {
  if (!hasActionableGenerations(summary)) {
    return [];
  }

  const priorityLabel = formatPriorityGenerateButtonText(summary.priorityRequestSku);
  const elements = [
    button({
      actionId: SLACK_ACTION_IDS.priority,
      text: priorityLabel,
      value: encodeSlackImportValue(summary.importId),
      style: "primary",
    }),
    button({
      actionId: SLACK_ACTION_IDS.choose,
      text: "Choose product",
      value: encodeSlackImportValue(summary.importId),
    }),
  ];

  if (options?.campaignPageUrl) {
    elements.push(
      button({
        text: "Campaign overview",
        url: options.campaignPageUrl,
      }),
    );
  }

  elements.push(
    button({
      actionId: SLACK_ACTION_IDS.cancel,
      text: "Cancel",
      value: encodeSlackImportValue(summary.importId),
      style: "danger",
    }),
  );

  return [
    {
      type: "actions",
      block_id: `ss_imp_actions:${summary.importId}`,
      elements,
    },
  ];
};

/**
 * Block Kit preview for a catalog import. Uses the shared RequestPlanSummary —
 * no separate planning logic.
 */
export const buildSlackImportPreviewBlocks = (
  summary: RequestPlanSummary,
  options?: { campaignPageUrl?: string | null; includeActions?: boolean },
): SlackBlock[] => {
  const includeActions = options?.includeActions !== false;
  const readyCount = summary.requestsReadyToGenerate;
  const otherProducts = summary.actionableProducts.filter(
    (product) => product.sku !== summary.priorityRequestSku,
  );
  const otherProductsText =
    otherProducts.length === 0
      ? "_None_"
      : otherProducts
          .slice(0, 12)
          .map((product) => `• *${product.sku}* (${product.priority})`)
          .join("\n");

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Catalog ready", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${readyCount} products ready to generate*`,
      },
    },
    {
      type: "section",
      fields: [
        field("Planned images", String(summary.plannedGenerations)),
        field(
          "Total estimated cost",
          formatUsdMicros(summary.additionalEstimatedCostMicrosUsd),
        ),
        field(
          "Cost per product",
          `${formatUsdMicros(estimatedCostMicrosForOneProduct())} (3 candidates)`,
        ),
        field("Aspect ratio", MVP_ASPECT_RATIO),
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Up next*\n${formatPriorityProductLabel(summary)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Other products*\n${otherProductsText}`,
      },
    },
  ];

  if (summary.warnings.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Warnings*\n${summary.warnings
          .slice(0, 6)
          .map((warning) => `• *${warning.sku}*: ${warning.message}`)
          .join("\n")}`,
      },
    });
  }

  if (!hasActionableGenerations(summary)) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: IMPORT_UP_TO_DATE_MESSAGE }],
    });
  } else if (includeActions) {
    blocks.push(...buildSlackImportActionElements(summary, options));
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: formatImportDetailsContextLine(summary),
      },
    ],
  });

  return blocks;
};

export const buildSlackImportPreviewFallbackText = (
  summary: RequestPlanSummary,
  options?: { campaignPageUrl?: string | null },
): string => {
  const readyCount = summary.requestsReadyToGenerate;
  const otherProducts = summary.actionableProducts.filter(
    (product) => product.sku !== summary.priorityRequestSku,
  );
  const lines = [
    "Catalog ready",
    "",
    `${readyCount} products ready to generate`,
    "",
    `Planned images: ${summary.plannedGenerations}`,
    `Total estimated cost: ${formatUsdMicros(summary.additionalEstimatedCostMicrosUsd)}`,
    `Cost per product: ${formatUsdMicros(estimatedCostMicrosForOneProduct())} (3 candidates)`,
    `Aspect ratio: ${MVP_ASPECT_RATIO}`,
    "",
    `Up next: ${formatPriorityProductLabel(summary)}`,
  ];

  if (otherProducts.length > 0) {
    lines.push(
      "",
      "Other products:",
      ...otherProducts
        .slice(0, 12)
        .map((product) => `- ${product.sku} (${product.priority})`),
    );
  }

  if (summary.warnings.length > 0) {
    lines.push(
      "",
      "Warnings:",
      ...summary.warnings
        .slice(0, 6)
        .map((warning) => `- ${warning.sku}: ${warning.message}`),
    );
  }

  lines.push("", formatImportDetailsContextLine(summary));

  if (options?.campaignPageUrl) {
    lines.push("", `Campaign overview: ${options.campaignPageUrl}`);
  }

  if (!hasActionableGenerations(summary)) {
    lines.push("", IMPORT_UP_TO_DATE_MESSAGE);
  }

  return lines.join("\n");
};

export const buildSlackProductPickerLoadingBlocks = (
  importId: string,
): { text: string; blocks: SlackBlock[] } => ({
  text: "Choose a product to generate\n\nLoading actionable products…",
  blocks: [
    {
      type: "header",
      text: { type: "plain_text", text: "Choose a product", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_Loading actionable products…_",
      },
    },
    {
      type: "actions",
      block_id: `ss_imp_picker_loading:${importId}`,
      elements: [
        button({
          actionId: SLACK_ACTION_IDS.back,
          text: "Back",
          value: encodeSlackImportValue(importId),
        }),
      ],
    },
  ],
});

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

  for (const [chunkIndex, group] of chunkSlackPickerProducts(
    pageItems,
    SLACK_MAX_BUTTONS_PER_ACTIONS_BLOCK,
  ).entries()) {
    blocks.push({
      type: "actions",
      block_id: `ss_imp_gen:${params.importId}:${safePage}:${chunkIndex}`,
      elements: group.map((option) =>
        button({
          actionId: SLACK_ACTION_IDS.gen,
          text: formatProductPickerButtonText(option),
          value: encodeSlackGenValue(params.importId, option.requestId, option.sku),
        }),
      ),
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

export const buildSlackGenerationStartedFallbackText = (sku: string): string => {
  const cost = formatOneProductCostLabel();
  return [
    `✨ Generating ${sku}`,
    "",
    `Candidates: ${CANDIDATES_PER_REQUEST}`,
    `Estimated cost: ${cost}`,
    `Aspect ratio: ${MVP_ASPECT_RATIO}`,
    `Generation mode: ${SLACK_GENERATION_MODE}`,
    "",
    "Results will appear in this channel as each candidate is ready.",
  ].join("\n");
};

export const buildSlackGenerationStartedBlocks = (sku: string): SlackBlock[] => {
  const cost = formatOneProductCostLabel();
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `✨ Generating ${sku}`.slice(0, 150),
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        field("Candidates", String(CANDIDATES_PER_REQUEST)),
        field("Estimated cost", cost),
        field("Aspect ratio", MVP_ASPECT_RATIO),
        field("Generation mode", SLACK_GENERATION_MODE),
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Results will appear in this channel as each candidate is ready.",
        },
      ],
    },
  ];
};

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

/**
 * Drop action buttons and stamp Approved/Rejected on an existing candidate message.
 * Used to ack Slack interactions before any DB work so buttons disappear immediately.
 */
export const finalizeSlackCandidateMessageBlocks = (
  blocks: SlackBlock[],
  decision: "approved" | "rejected",
): SlackBlock[] => {
  const statusLine =
    decision === "approved" ? "*Status: Approved*" : "*Status: Rejected*";

  return blocks
    .filter((block) => block.type !== "actions")
    .map((block) => {
      if (block.type !== "section") {
        return block;
      }
      const text = block.text;
      if (!text || typeof text !== "object") {
        return block;
      }
      const mrkdwn = text as { type?: string; text?: string };
      if (typeof mrkdwn.text !== "string") {
        return block;
      }
      if (!/candidate\s+\d+\s*\/\s*\d+/i.test(mrkdwn.text)) {
        return block;
      }
      const firstLine = mrkdwn.text.split("\n")[0] ?? mrkdwn.text;
      return {
        ...block,
        text: {
          ...mrkdwn,
          text: `${firstLine}\n${statusLine}`,
        },
      };
    });
};
