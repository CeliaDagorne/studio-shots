import {
  CANDIDATES_PER_REQUEST,
  estimatedCostMicrosForOneProduct,
  formatOneProductCostLabel,
  formatPriorityGenerateButtonText,
  formatProductPickerButtonText,
  formatUsdMicros,
  hasActionableGenerations,
  IMPORT_UP_TO_DATE_MESSAGE,
} from "@/lib/request-planning";
import { candidateCaption, MIN_APPROVALS_TO_COMPLETE } from "@/lib/review";
import {
  SLACK_FAKE_CANDIDATE_CONTEXT,
  SLACK_FAKE_GENERATION_CONTEXT,
} from "@/lib/image-generation";
import {
  OUTPUT_ASPECT_RATIOS,
  outputAspectRatioLabel,
  parseOutputAspectRatio,
  type OutputAspectRatio,
} from "@/lib/output-format";
import { isSlackAccessibleImageUrl } from "@/lib/slack-image-url";
import type { ActionableProductOption, RequestPlanSummary } from "@/types";

export type SlackBlock = Record<string, unknown>;

/** Slack allows at most 5 `actions` blocks and 5 buttons per block in a message. */
export const SLACK_MAX_ACTIONS_BLOCKS_PER_MESSAGE = 5;
export const SLACK_MAX_BUTTONS_PER_ACTIONS_BLOCK = 5;

export const SLACK_PRODUCT_PICKER_PAGE_SIZE = 6;

const testModeContextBlock = (): SlackBlock => ({
  type: "context",
  elements: [
    {
      type: "plain_text",
      text: SLACK_FAKE_GENERATION_CONTEXT.slice(0, 3000),
      emoji: true,
    },
  ],
});

const testCandidateContextBlock = (): SlackBlock => ({
  type: "context",
  elements: [
    {
      type: "plain_text",
      text: SLACK_FAKE_CANDIDATE_CONTEXT.slice(0, 3000),
      emoji: true,
    },
  ],
});

/** Escape dynamic text for Slack mrkdwn (Shot Ideas, SKUs, etc.). */
export const escapeSlackMrkdwn = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[*_~`]/g, (ch) => `\\${ch}`);

const truncateSlackText = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  if (max <= 1) {
    return value.slice(0, max);
  }
  return `${value.slice(0, max - 1)}…`;
};

const formatSlackPriorityGenerateButtonText = (
  sku: string | null | undefined,
  testMode: boolean,
): string => {
  if (!testMode) {
    return formatPriorityGenerateButtonText(sku);
  }
  return sku ? `Generate test candidates: ${sku}` : "Generate test candidates";
};

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
  /** Set campaign output aspect ratio before the first generation. */
  format: "ss_imp_format",
  /** Retry generation after failure or regenerate under-threshold reviews. */
  retry: "ss_req_retry",
  /** Re-deliver existing ready candidates without creating a new generation. */
  resend: "ss_cand_resend",
  approve: "ss_cand_approve",
  reject: "ss_cand_reject",
} as const;

const VALUE_SEP = "::";

const isOutputAspectRatioSafe = (value: string): value is OutputAspectRatio =>
  (OUTPUT_ASPECT_RATIOS as readonly string[]).includes(value);

export const encodeSlackFormatValue = (
  importId: string,
  ratio: OutputAspectRatio,
): string => `${importId}${VALUE_SEP}${ratio}`;

export const parseSlackFormatValue = (
  value: string,
): { importId: string; ratio: OutputAspectRatio } | null => {
  const idx = value.indexOf(VALUE_SEP);
  if (idx <= 0) return null;
  const importId = value.slice(0, idx);
  const ratio = value.slice(idx + VALUE_SEP.length);
  if (!importId || !isOutputAspectRatioSafe(ratio)) return null;
  return { importId, ratio };
};

/** Unique per-SKU generate button — Slack forbids duplicate action_ids in one message. */
export const slackGenActionIdForSku = (sku: string): string =>
  `${SLACK_ACTION_IDS.gen}:${sku}`;

export const slackPageActionId = (direction: "prev" | "next"): string =>
  `${SLACK_ACTION_IDS.page}:${direction}`;

export const isSlackGenActionId = (actionId: string): boolean =>
  actionId === SLACK_ACTION_IDS.gen ||
  actionId.startsWith(`${SLACK_ACTION_IDS.gen}:`);

export const isSlackPageActionId = (actionId: string): boolean =>
  actionId === SLACK_ACTION_IDS.page ||
  actionId.startsWith(`${SLACK_ACTION_IDS.page}:`);

export const isSlackFormatActionId = (actionId: string): boolean =>
  actionId === SLACK_ACTION_IDS.format ||
  actionId.startsWith(`${SLACK_ACTION_IDS.format}:`);

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

const formatUpNextSection = (summary: RequestPlanSummary): string => {
  if (!summary.priorityRequestSku) {
    return "🎯 *Up next*\n_None detected_";
  }
  const priority = summary.priorityRequestPriority ?? "normal";
  return `🎯 *Up next*\n*${summary.priorityRequestSku}* · ${priority} priority`;
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
  options?: { campaignPageUrl?: string | null; testMode?: boolean },
): SlackBlock[] => {
  if (!hasActionableGenerations(summary)) {
    return [];
  }

  const testMode = Boolean(options?.testMode);
  const priorityLabel = formatSlackPriorityGenerateButtonText(
    summary.priorityRequestSku,
    testMode,
  );
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
const buildSlackOutputFormatSection = (
  summary: RequestPlanSummary,
): SlackBlock[] => {
  const ratio = parseOutputAspectRatio(summary.outputAspectRatio);
  const locked = Boolean(summary.outputAspectRatioLocked);
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: locked
          ? `*Output format*\nSelected: *${outputAspectRatioLabel(ratio)}* · locked after first generation`
          : `*Output format*\nSelected: *${outputAspectRatioLabel(ratio)}*`,
      },
    },
  ];

  if (!locked) {
    blocks.push({
      type: "actions",
      block_id: `ss_imp_format:${summary.importId}`,
      elements: OUTPUT_ASPECT_RATIOS.map((option) =>
        button({
          actionId: `${SLACK_ACTION_IDS.format}:${option}`,
          text: outputAspectRatioLabel(option),
          value: encodeSlackFormatValue(summary.importId, option),
          style: option === ratio ? "primary" : undefined,
        }),
      ),
    });
  }

  return blocks;
};

export const buildSlackImportPreviewBlocks = (
  summary: RequestPlanSummary,
  options?: {
    campaignPageUrl?: string | null;
    includeActions?: boolean;
    testMode?: boolean;
  },
): SlackBlock[] => {
  const includeActions = options?.includeActions !== false;
  const testMode = Boolean(options?.testMode);
  const readyCount = summary.requestsReadyToGenerate;
  const perProductCost = formatUsdMicros(estimatedCostMicrosForOneProduct());
  const otherProducts = summary.actionableProducts.filter(
    (product) => product.sku !== summary.priorityRequestSku,
  );
  const otherProductsText = otherProducts
    .slice(0, 12)
    .map((product) => `• *${product.sku}* (${product.priority})`)
    .join("\n");

  const estimatedCostLabel = testMode ? "Estimated production cost" : "Estimated cost";
  const perProductLabel = testMode ? "Production cost per product" : "Per product";
  const ratio = parseOutputAspectRatio(summary.outputAspectRatio);

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "📸 Catalog ready", emoji: true },
    },
  ];

  if (testMode) {
    blocks.push(testModeContextBlock());
  }

  blocks.push(
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
        field("Planned output", `${summary.plannedGenerations} images`),
        field(
          estimatedCostLabel,
          `${formatUsdMicros(summary.additionalEstimatedCostMicrosUsd)} total`,
        ),
        field(
          perProductLabel,
          `${perProductCost} · ${CANDIDATES_PER_REQUEST} candidates`,
        ),
        field("Format", outputAspectRatioLabel(ratio)),
      ],
    },
    { type: "divider" },
    ...buildSlackOutputFormatSection(summary),
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: formatUpNextSection(summary),
      },
    },
  );

  if (otherProducts.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Also available*\n${otherProductsText}`,
      },
    });
  }

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
  options?: { campaignPageUrl?: string | null; testMode?: boolean },
): string => {
  const testMode = Boolean(options?.testMode);
  const readyCount = summary.requestsReadyToGenerate;
  const perProductCost = formatUsdMicros(estimatedCostMicrosForOneProduct());
  const otherProducts = summary.actionableProducts.filter(
    (product) => product.sku !== summary.priorityRequestSku,
  );
  const estimatedCostLabel = testMode ? "Estimated production cost" : "Estimated cost";
  const perProductLabel = testMode ? "Production cost per product" : "Per product";
  const lines = ["📸 Catalog ready", ""];
  if (testMode) {
    lines.push(SLACK_FAKE_GENERATION_CONTEXT, "");
  }
  lines.push(
    `${readyCount} products ready to generate`,
    "",
    `Planned output: ${summary.plannedGenerations} images`,
    `${estimatedCostLabel}: ${formatUsdMicros(summary.additionalEstimatedCostMicrosUsd)} total`,
    `${perProductLabel}: ${perProductCost} · ${CANDIDATES_PER_REQUEST} candidates`,
    `Format: ${outputAspectRatioLabel(parseOutputAspectRatio(summary.outputAspectRatio))}`,
    "",
  );
  if (summary.priorityRequestSku) {
    const priority = summary.priorityRequestPriority ?? "normal";
    lines.push(
      `Up next: ${summary.priorityRequestSku} · ${priority} priority`,
    );
  } else {
    lines.push("Up next: None detected");
  }

  if (otherProducts.length > 0) {
    lines.push(
      "",
      "Also available:",
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
          actionId: slackGenActionIdForSku(option.sku),
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
        actionId: slackPageActionId("prev"),
        text: "Previous",
        value: encodeSlackPageValue(params.importId, safePage - 1),
      }),
    );
  }
  if (safePage < totalPages - 1) {
    navElements.push(
      button({
        actionId: slackPageActionId("next"),
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
  options?: { campaignPageUrl?: string | null; testMode?: boolean },
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

export type GenerationStartedMessageParams = {
  sku: string;
  shotIdea?: string | null;
  testMode?: boolean;
  outputAspectRatio?: OutputAspectRatio | string;
};

const normalizeShotIdea = (shotIdea: string | null | undefined): string | null => {
  if (typeof shotIdea !== "string") {
    return null;
  }
  const trimmed = shotIdea.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const generationStartedSummaryLine = (
  testMode: boolean,
  ratio: OutputAspectRatio,
): string => {
  const format = outputAspectRatioLabel(ratio);
  if (testMode) {
    return `${CANDIDATES_PER_REQUEST} demo candidates · ${format} · $0.00 charged`;
  }
  return `${CANDIDATES_PER_REQUEST} lifestyle candidates · ${format} · ${formatOneProductCostLabel()}`;
};

const generationStartedSummaryMrkdwn = (
  testMode: boolean,
  ratio: OutputAspectRatio,
): string => {
  const format = outputAspectRatioLabel(ratio);
  if (testMode) {
    return `*${CANDIDATES_PER_REQUEST} demo candidates* · *${format}* · *$0.00 charged*`;
  }
  return `*${CANDIDATES_PER_REQUEST} lifestyle candidates* · *${format}* · *${formatOneProductCostLabel()}*`;
};

const generationStartedSupportLine = (testMode: boolean): string =>
  testMode
    ? "Creating free demo candidates (not Luma images). Results will appear here when ready."
    : "Using the catalog product photo as the source. Results will appear here when ready.";

export const buildSlackGenerationStartedFallbackText = (
  params: GenerationStartedMessageParams | string,
): string => {
  const { sku, shotIdea, testMode, outputAspectRatio } =
    typeof params === "string"
      ? { sku: params, shotIdea: null, testMode: false, outputAspectRatio: undefined }
      : { testMode: false, ...params };
  const ratio = parseOutputAspectRatio(outputAspectRatio);
  const idea = normalizeShotIdea(shotIdea);
  const lines = [`✨ Generating ${sku}`, ""];
  if (testMode) {
    lines.push(SLACK_FAKE_GENERATION_CONTEXT, "");
  }
  if (idea) {
    lines.push("Creative direction", idea, "");
  }
  lines.push(
    generationStartedSummaryLine(Boolean(testMode), ratio),
    "",
    generationStartedSupportLine(Boolean(testMode)),
  );
  return lines.join("\n");
};

export const buildSlackGenerationStartedBlocks = (
  params: GenerationStartedMessageParams | string,
): SlackBlock[] => {
  const { sku, shotIdea, testMode, outputAspectRatio } =
    typeof params === "string"
      ? { sku: params, shotIdea: null, testMode: false, outputAspectRatio: undefined }
      : { testMode: false, ...params };
  const ratio = parseOutputAspectRatio(outputAspectRatio);
  const idea = normalizeShotIdea(shotIdea);
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncateSlackText(`✨ Generating ${sku}`, 150),
        emoji: true,
      },
    },
  ];

  if (testMode) {
    blocks.push(testModeContextBlock());
  }

  if (idea) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncateSlackText(
          `*Creative direction*\n_${escapeSlackMrkdwn(idea)}_`,
          3000,
        ),
      },
    });
  }

  blocks.push(
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncateSlackText(
          generationStartedSummaryMrkdwn(Boolean(testMode), ratio),
          3000,
        ),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: truncateSlackText(generationStartedSupportLine(Boolean(testMode)), 3000),
        },
      ],
    },
  );

  return blocks;
};

export const buildSlackCandidatesReadyFallbackText = (params: {
  sku: string;
  candidateCount: number;
  approvalThreshold?: number;
  testMode?: boolean;
}): string => {
  const threshold = params.approvalThreshold ?? MIN_APPROVALS_TO_COMPLETE;
  const lines = [`🖼️ ${params.sku} ready for review`, ""];
  if (params.testMode) {
    lines.push(SLACK_FAKE_CANDIDATE_CONTEXT, "");
  }
  lines.push(
    `${params.candidateCount} candidates are ready. Approve or reject each image.`,
    "",
    `Approve at least ${threshold} candidates to complete this product.`,
  );
  return lines.join("\n");
};

export const buildSlackCandidatesReadyBlocks = (params: {
  sku: string;
  candidateCount: number;
  approvalThreshold?: number;
  testMode?: boolean;
}): { text: string; blocks: SlackBlock[] } => {
  const threshold = params.approvalThreshold ?? MIN_APPROVALS_TO_COMPLETE;
  const text = buildSlackCandidatesReadyFallbackText(params);
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🖼️ ${params.sku} ready for review`.slice(0, 150),
        emoji: true,
      },
    },
  ];
  if (params.testMode) {
    blocks.push(testCandidateContextBlock());
  }
  blocks.push(
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${params.candidateCount} candidates are ready.* Approve or reject each image.`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Approve at least ${threshold} candidates to complete this product.`,
        },
      ],
    },
  );
  return { text, blocks };
};

export const buildSlackProductApprovedFallbackText = (params: {
  sku: string;
  approvalCount: number;
  productPageUrl: string;
  campaignPageUrl?: string | null;
  nextProduct?: ActionableProductOption | null;
  importId?: string | null;
  testMode?: boolean;
}): string => buildSlackProductResolutionFallbackText({
  ...params,
  outcome: "approved",
});

export const buildSlackProductApprovedBlocks = (params: {
  sku: string;
  approvalCount: number;
  productPageUrl: string;
  campaignPageUrl?: string | null;
  nextProduct?: ActionableProductOption | null;
  importId?: string | null;
  testMode?: boolean;
}): { text: string; blocks: SlackBlock[] } =>
  buildSlackProductResolutionBlocks({
    ...params,
    outcome: "approved",
  });

export const buildSlackProductResolutionFallbackText = (params: {
  outcome: "approved" | "needs_regeneration";
  sku: string;
  approvalCount: number;
  productPageUrl: string;
  campaignPageUrl?: string | null;
  nextProduct?: ActionableProductOption | null;
  importId?: string | null;
  requestId?: string | null;
  testMode?: boolean;
}): string => {
  if (params.outcome === "approved") {
    const lines = [
      `✅ ${params.sku} approved`,
      "",
      `${params.approvalCount} candidates approved. This product is complete.`,
      "",
      `View product: ${params.productPageUrl}`,
    ];
    if (params.testMode) {
      lines.splice(1, 0, "", SLACK_FAKE_CANDIDATE_CONTEXT);
    }
    if (params.nextProduct && params.importId) {
      lines.push(
        "",
        "➡️ Next up",
        `${params.nextProduct.sku} · ${params.nextProduct.priority} priority`,
        "",
        `Generate ${params.nextProduct.sku}`,
        "Choose another product",
      );
    } else if (params.importId) {
      lines.push("", "🎉 Campaign complete", "", "All actionable products have been reviewed.");
    }
    if (params.campaignPageUrl) {
      lines.push("", `View campaign: ${params.campaignPageUrl}`);
    }
    return lines.join("\n");
  }

  const lines = [
    `🔁 ${params.sku} still needs a usable image`,
    "",
    "No candidate reached the approval threshold.",
  ];
  if (params.testMode) {
    lines.splice(1, 0, "", SLACK_FAKE_CANDIDATE_CONTEXT);
  }
  lines.push(
    "",
    params.testMode
      ? "Generate new test candidates"
      : `Generate 3 new candidates · ${formatOneProductCostLabel()}`,
    "Choose another product",
  );
  if (params.campaignPageUrl) {
    lines.push("", `View campaign: ${params.campaignPageUrl}`);
  }
  return lines.join("\n");
};

const buildCampaignContinuationBlocks = (params: {
  sku: string;
  importId: string;
  campaignPageUrl?: string | null;
  nextProduct: ActionableProductOption | null;
  includeDivider?: boolean;
  testMode?: boolean;
}): SlackBlock[] => {
  const includeDivider = params.includeDivider !== false;

  if (params.nextProduct) {
    const elements = [
      button({
        actionId: SLACK_ACTION_IDS.gen,
        text: `Generate ${params.nextProduct.sku}`,
        value: encodeSlackGenValue(
          params.importId,
          params.nextProduct.requestId,
          params.nextProduct.sku,
        ),
        style: "primary",
      }),
      button({
        actionId: SLACK_ACTION_IDS.choose,
        text: "Choose another product",
        value: encodeSlackImportValue(params.importId),
      }),
    ];
    if (params.campaignPageUrl) {
      elements.push(
        button({
          text: "View campaign",
          url: params.campaignPageUrl,
        }),
      );
    }
    const blocks: SlackBlock[] = [];
    if (includeDivider) {
      blocks.push({ type: "divider" });
    }
    // Standalone continuation/status messages include the notice; nested
    // resolution messages already show it above the divider.
    if (params.testMode && !includeDivider) {
      blocks.push(testCandidateContextBlock());
    }
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `➡️ *Next up*\n*${params.nextProduct.sku}* · ${params.nextProduct.priority} priority`,
        },
      },
      {
        type: "actions",
        block_id: `ss_continue:${params.importId}:${params.nextProduct.sku}`,
        elements,
      },
    );
    return blocks;
  }

  const completeBlocks: SlackBlock[] = [];
  if (includeDivider) {
    completeBlocks.push({ type: "divider" });
  }
  if (params.testMode && !includeDivider) {
    completeBlocks.push(testCandidateContextBlock());
  }
  completeBlocks.push(
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🎉 Campaign complete",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "All actionable products have been reviewed.",
      },
    },
  );

  if (params.campaignPageUrl) {
    completeBlocks.push({
      type: "actions",
      block_id: `ss_campaign_complete:${params.importId || params.sku}`,
      elements: [
        button({
          text: "View campaign",
          url: params.campaignPageUrl,
        }),
      ],
    });
  }

  return completeBlocks;
};

export const buildSlackCampaignStatusFallbackText = (params: {
  nextProduct: ActionableProductOption | null;
  campaignPageUrl?: string | null;
  testMode?: boolean;
}): string => {
  if (params.nextProduct) {
    const lines = ["➡️ Next up"];
    if (params.testMode) {
      lines.push("", SLACK_FAKE_CANDIDATE_CONTEXT);
    }
    lines.push(
      "",
      `${params.nextProduct.sku} · ${params.nextProduct.priority} priority`,
      "",
      `Generate ${params.nextProduct.sku}`,
      "Choose another product",
    );
    if (params.campaignPageUrl) {
      lines.push("", `View campaign: ${params.campaignPageUrl}`);
    }
    return lines.join("\n");
  }

  const lines = ["🎉 Campaign complete"];
  if (params.testMode) {
    lines.push("", SLACK_FAKE_CANDIDATE_CONTEXT);
  }
  lines.push("", "All actionable products have been reviewed.");
  if (params.campaignPageUrl) {
    lines.push("", `View campaign: ${params.campaignPageUrl}`);
  }
  return lines.join("\n");
};

/** Standalone campaign status / continuation message for Slack mentions. */
export const buildSlackCampaignStatusBlocks = (params: {
  importId: string;
  campaignPageUrl: string;
  nextProduct: ActionableProductOption | null;
  testMode?: boolean;
}): { text: string; blocks: SlackBlock[] } => ({
  text: buildSlackCampaignStatusFallbackText({
    nextProduct: params.nextProduct,
    campaignPageUrl: params.campaignPageUrl,
    testMode: params.testMode,
  }),
  blocks: buildCampaignContinuationBlocks({
    sku: params.nextProduct?.sku ?? "complete",
    importId: params.importId,
    campaignPageUrl: params.campaignPageUrl,
    nextProduct: params.nextProduct,
    includeDivider: false,
    testMode: params.testMode,
  }),
});

export const buildSlackProductResolutionBlocks = (params: {
  outcome: "approved" | "needs_regeneration";
  sku: string;
  approvalCount: number;
  productPageUrl: string;
  campaignPageUrl?: string | null;
  nextProduct?: ActionableProductOption | null;
  importId?: string | null;
  requestId?: string | null;
  testMode?: boolean;
}): { text: string; blocks: SlackBlock[] } => {
  const text = buildSlackProductResolutionFallbackText(params);

  if (params.outcome === "needs_regeneration") {
    const blocks: SlackBlock[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: truncateSlackText(`🔁 ${params.sku} still needs a usable image`, 150),
          emoji: true,
        },
      },
      ...(params.testMode ? [testCandidateContextBlock()] : []),
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "No candidate reached the approval threshold.",
        },
      },
    ];

    if (params.importId && params.requestId) {
      const regenerateLabel = params.testMode
        ? "Generate new test candidates"
        : `Generate 3 new candidates · ${formatOneProductCostLabel()}`;
      const elements = [
        button({
          actionId: SLACK_ACTION_IDS.retry,
          text: regenerateLabel,
          value: encodeSlackGenValue(params.importId, params.requestId, params.sku),
          style: "primary",
        }),
        button({
          actionId: SLACK_ACTION_IDS.choose,
          text: "Choose another product",
          value: encodeSlackImportValue(params.importId),
        }),
      ];
      if (params.campaignPageUrl) {
        elements.push(
          button({
            text: "View campaign",
            url: params.campaignPageUrl,
          }),
        );
      }
      blocks.push({
        type: "actions",
        block_id: `ss_needs_regen:${params.requestId}`,
        elements,
      });
    } else if (params.campaignPageUrl) {
      blocks.push({
        type: "actions",
        block_id: `ss_needs_regen_links:${params.sku}`,
        elements: [
          button({
            text: "View campaign",
            url: params.campaignPageUrl,
          }),
        ],
      });
    }

    return { text, blocks };
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `✅ ${params.sku} approved`.slice(0, 150),
        emoji: true,
      },
    },
    ...(params.testMode ? [testCandidateContextBlock()] : []),
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${params.approvalCount} candidates approved.* This product is complete.`,
      },
    },
    {
      type: "actions",
      block_id: `ss_approved_links:${params.sku}`,
      elements: [
        button({
          text: "View product",
          url: params.productPageUrl,
        }),
      ],
    },
  ];

  if (params.importId) {
    blocks.push(
      ...buildCampaignContinuationBlocks({
        sku: params.sku,
        importId: params.importId,
        campaignPageUrl: params.campaignPageUrl,
        nextProduct: params.nextProduct ?? null,
        testMode: params.testMode,
      }),
    );
  } else if (params.campaignPageUrl) {
    blocks.push({
      type: "actions",
      block_id: `ss_resolution_links:${params.sku}`,
      elements: [
        button({
          text: "View campaign",
          url: params.campaignPageUrl,
        }),
      ],
    });
  }

  return { text, blocks };
};

export const buildSlackCandidateDeliveryFailedText = (params: {
  sku: string;
  candidateIndex: number;
  total: number;
}): string =>
  [
    `${params.sku} candidate ${params.candidateIndex}/${params.total}`,
    "",
    "⚠️ Review controls could not be delivered for this candidate.",
    "The image was generated successfully, but Slack could not show Approve/Reject buttons.",
    "Use Resend review messages (if offered). Do not regenerate just to recover delivery.",
  ].join("\n");

export const buildSlackGenerationFailedFallbackText = (params: {
  sku: string;
  campaignPageUrl?: string | null;
  testMode?: boolean;
}): string => {
  const lines = [`⚠️ Generation failed for ${params.sku}`];
  if (params.testMode) {
    lines.push("", SLACK_FAKE_GENERATION_CONTEXT);
  }
  lines.push("", `Retry ${params.sku}`, "Choose another product");
  if (params.campaignPageUrl) {
    lines.push("", `View campaign: ${params.campaignPageUrl}`);
  }
  return lines.join("\n");
};

export const buildSlackGenerationFailedBlocks = (params: {
  sku: string;
  importId: string;
  requestId: string;
  campaignPageUrl?: string | null;
  testMode?: boolean;
}): { text: string; blocks: SlackBlock[] } => {
  const text = buildSlackGenerationFailedFallbackText(params);
  const elements = [
    button({
      actionId: SLACK_ACTION_IDS.retry,
      text: `Retry ${params.sku}`,
      value: encodeSlackGenValue(params.importId, params.requestId, params.sku),
      style: "primary",
    }),
    button({
      actionId: SLACK_ACTION_IDS.choose,
      text: "Choose another product",
      value: encodeSlackImportValue(params.importId),
    }),
  ];
  if (params.campaignPageUrl) {
    elements.push(
      button({
        text: "View campaign",
        url: params.campaignPageUrl,
      }),
    );
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncateSlackText(`⚠️ Generation failed for ${params.sku}`, 150),
        emoji: true,
      },
    },
  ];
  if (params.testMode) {
    blocks.push(testModeContextBlock());
  }
  blocks.push({
    type: "actions",
    block_id: `ss_gen_failed:${params.requestId}`,
    elements,
  });

  return { text, blocks };
};

export const buildSlackDeliveryFailedFallbackText = (params: {
  sku: string;
  readyCount: number;
  campaignPageUrl?: string | null;
  testMode?: boolean;
}): string => {
  const lines = [
    `⚠️ Could not deliver review controls for ${params.sku}`,
    "",
    `${params.readyCount} candidate(s) are ready. Resend review messages without regenerating.`,
  ];
  if (params.testMode) {
    lines.splice(1, 0, "", SLACK_FAKE_CANDIDATE_CONTEXT);
  }
  lines.push("", "Resend review messages", "Choose another product");
  if (params.campaignPageUrl) {
    lines.push("", `View campaign: ${params.campaignPageUrl}`);
  }
  return lines.join("\n");
};

export const buildSlackDeliveryFailedBlocks = (params: {
  sku: string;
  importId: string;
  requestId: string;
  readyCount: number;
  campaignPageUrl?: string | null;
  testMode?: boolean;
}): { text: string; blocks: SlackBlock[] } => {
  const text = buildSlackDeliveryFailedFallbackText(params);
  const elements = [
    button({
      actionId: SLACK_ACTION_IDS.resend,
      text: "Resend review messages",
      value: encodeSlackGenValue(params.importId, params.requestId, params.sku),
      style: "primary",
    }),
    button({
      actionId: SLACK_ACTION_IDS.choose,
      text: "Choose another product",
      value: encodeSlackImportValue(params.importId),
    }),
  ];
  if (params.campaignPageUrl) {
    elements.push(
      button({
        text: "View campaign",
        url: params.campaignPageUrl,
      }),
    );
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncateSlackText(
          `⚠️ Could not deliver review controls for ${params.sku}`,
          150,
        ),
        emoji: true,
      },
    },
  ];
  if (params.testMode) {
    blocks.push(testCandidateContextBlock());
  }
  blocks.push(
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${params.readyCount} candidate(s) are ready.* Resend review messages without regenerating.`,
      },
    },
    {
      type: "actions",
      block_id: `ss_delivery_failed:${params.requestId}`,
      elements,
    },
  );

  return { text, blocks };
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
  testMode?: boolean;
  /** Shown when generated pixels do not match the campaign output ratio. */
  formatWarning?: string | null;
}): { text: string; blocks: SlackBlock[] } => {
  const statusLine =
    params.reviewDecision === "approved"
      ? "*✅ Approved*"
      : params.reviewDecision === "rejected"
        ? "*❌ Rejected*"
        : "Review this candidate independently.";
  const formatWarning =
    typeof params.formatWarning === "string" && params.formatWarning.trim().length > 0
      ? params.formatWarning.trim()
      : null;

  const textLines =
    params.reviewDecision === "approved" || params.reviewDecision === "rejected"
      ? [
          candidateCaption({
            sku: params.sku,
            index: params.candidateIndex,
            total: params.total,
            reviewDecision: params.reviewDecision,
          }),
        ]
      : [params.caption];
  if (formatWarning) {
    textLines.push("", formatWarning);
  }
  if (params.testMode) {
    textLines.push("", SLACK_FAKE_CANDIDATE_CONTEXT);
  }
  const text = textLines.join("\n");

  const headerLines = [
    `*${params.sku}* · candidate ${params.candidateIndex}/${params.total}`,
    statusLine,
  ];
  if (formatWarning) {
    headerLines.push(`⚠️ ${escapeSlackMrkdwn(formatWarning)}`);
  }

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: headerLines.join("\n"),
      },
    },
  ];

  if (params.testMode) {
    blocks.push(testCandidateContextBlock());
  }

  const altText = truncateSlackText(
    `${params.sku} candidate ${params.candidateIndex}`.trim() || "Studio Shots candidate",
    2000,
  );

  blocks.push({
    type: "image",
    image_url: params.blobUrl,
    alt_text: altText,
  });

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
 * Validate candidate Block Kit shape for Slack (image URL, alt_text, actions).
 * Returns human-readable problems; empty array means structurally acceptable.
 */
export const validateSlackCandidateBlocks = (blocks: SlackBlock[]): string[] => {
  const problems: string[] = [];

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return ["blocks must be a non-empty array"];
  }

  let imageCount = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block || typeof block !== "object") {
      problems.push(`blocks[${index}] must be an object`);
      continue;
    }
    const type = block.type;
    if (typeof type !== "string" || !type) {
      problems.push(`blocks[${index}].type is required`);
      continue;
    }

    if (type === "image") {
      imageCount += 1;
      const imageUrl = block.image_url;
      const altText = block.alt_text;
      if (typeof imageUrl !== "string" || !imageUrl.trim()) {
        problems.push(`blocks[${index}].image_url must be a non-empty string`);
      } else if (imageUrl.trim().startsWith("/")) {
        problems.push(`blocks[${index}].image_url must be absolute HTTPS (got relative path)`);
      } else if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\b/i.test(imageUrl)) {
        problems.push(`blocks[${index}].image_url must not use localhost`);
      } else if (!isSlackAccessibleImageUrl(imageUrl)) {
        problems.push(
          `blocks[${index}].image_url must be a public absolute HTTPS URL (got ${imageUrl})`,
        );
      }
      if (typeof altText !== "string" || !altText.trim()) {
        problems.push(`blocks[${index}].alt_text must be non-empty plain text`);
      } else if (altText.length > 2000) {
        problems.push(`blocks[${index}].alt_text exceeds 2000 characters`);
      }
    }

    if (type === "section") {
      const sectionText = block.text as { type?: string; text?: string } | undefined;
      if (sectionText) {
        if (sectionText.type !== "mrkdwn" && sectionText.type !== "plain_text") {
          problems.push(`blocks[${index}].text.type must be mrkdwn or plain_text`);
        }
        if (typeof sectionText.text !== "string" || !sectionText.text.trim()) {
          problems.push(`blocks[${index}].text.text must be non-empty`);
        } else if (sectionText.text.length > 3000) {
          problems.push(`blocks[${index}].text.text exceeds 3000 characters`);
        }
      }
    }

    if (type === "actions") {
      const elements = block.elements;
      if (!Array.isArray(elements) || elements.length === 0) {
        problems.push(`blocks[${index}].elements must be a non-empty array`);
      }
    }
  }

  if (imageCount === 0) {
    problems.push("candidate blocks must include an image block");
  }

  return problems;
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
    decision === "approved" ? "*✅ Approved*" : "*❌ Rejected*";

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
