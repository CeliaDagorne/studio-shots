import { isFakeImageGenerationProvider } from "@/lib/image-generation";
import type { OutputAspectRatio } from "@/lib/output-format";
import { CANDIDATES_PER_REQUEST } from "@/lib/request-planning";
import {
  buildSlackGenerationFailedBlocks,
  buildSlackGenerationProgressCompleteBlocks,
  buildSlackGenerationProgressPartialBlocks,
  buildSlackGenerationProgressTimeoutBlocks,
  type SlackBlock,
} from "@/lib/slack-blocks";
import { updateSlackMessage } from "@/lib/slack";

export type SlackGenerationProgressTarget = {
  channel: string;
  ts: string;
};

export type SlackGenerationProgressUpdater = {
  /** Update when a new candidate becomes ready (skipped if count unchanged). */
  onReadyCount: (ready: number) => Promise<void>;
  onComplete: (ready: number) => Promise<void>;
  onTimeout: (params: { ready: number; stillProcessing: number }) => Promise<void>;
  onFailed: (params: {
    importId: string;
    requestId: string;
    detail?: string | null;
    campaignPageUrl?: string | null;
  }) => Promise<void>;
};

type ProgressUpdateBody = {
  text: string;
  blocks: SlackBlock[];
};

/**
 * Best-effort chat.update helper for the generation progress message.
 * Slack failures are logged and never thrown — presentation must not affect generation.
 */
export const createSlackGenerationProgressUpdater = (params: {
  target: SlackGenerationProgressTarget | null | undefined;
  sku: string;
  total?: number;
  testMode?: boolean;
  outputAspectRatio?: OutputAspectRatio | string;
  updateMessage?: typeof updateSlackMessage;
}): SlackGenerationProgressUpdater => {
  const total = params.total ?? CANDIDATES_PER_REQUEST;
  const testMode = params.testMode ?? isFakeImageGenerationProvider();
  const updateMessage = params.updateMessage ?? updateSlackMessage;
  let lastReadyReported = 0;
  let lastPhase:
    | "idle"
    | "partial"
    | "complete"
    | "timeout"
    | "failed" = "idle";

  const publish = async (phase: typeof lastPhase, body: ProgressUpdateBody) => {
    if (!params.target) {
      return;
    }
    try {
      await updateMessage({
        channel: params.target.channel,
        ts: params.target.ts,
        text: body.text,
        blocks: body.blocks,
      });
      lastPhase = phase;
    } catch (error) {
      console.error(
        "[slack/generation-progress]",
        error instanceof Error ? error.message : "chat.update failed",
      );
    }
  };

  return {
    onReadyCount: async (ready: number) => {
      if (!params.target) {
        return;
      }
      if (ready <= 0 || ready >= total) {
        return;
      }
      if (lastPhase === "partial" && ready === lastReadyReported) {
        return;
      }
      lastReadyReported = ready;
      await publish(
        "partial",
        buildSlackGenerationProgressPartialBlocks({
          sku: params.sku,
          ready,
          total,
          testMode,
          outputAspectRatio: params.outputAspectRatio,
        }),
      );
    },

    onComplete: async (ready: number) => {
      if (!params.target) {
        return;
      }
      lastReadyReported = ready;
      await publish(
        "complete",
        buildSlackGenerationProgressCompleteBlocks({
          sku: params.sku,
          ready,
          total,
          testMode,
        }),
      );
    },

    onTimeout: async ({ ready, stillProcessing }) => {
      if (!params.target) {
        return;
      }
      lastReadyReported = ready;
      await publish(
        "timeout",
        buildSlackGenerationProgressTimeoutBlocks({
          sku: params.sku,
          ready,
          stillProcessing,
          total,
          testMode,
        }),
      );
    },

    onFailed: async ({ importId, requestId, detail, campaignPageUrl }) => {
      if (!params.target) {
        return;
      }
      await publish(
        "failed",
        buildSlackGenerationFailedBlocks({
          sku: params.sku,
          importId,
          requestId,
          campaignPageUrl,
          testMode,
          detail,
        }),
      );
    },
  };
};
