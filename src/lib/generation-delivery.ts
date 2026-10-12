import {
  CHAT_PLATFORM,
  requireSlackConversation,
  requireTelegramConversation,
  toExternalMessageId,
  type ChatConversation,
} from "@/lib/chat-identity";
import { env } from "@/lib/env";
import { fetchImageDimensions } from "@/lib/image-normalize";
import { isFakeImageGenerationProvider } from "@/lib/image-generation";
import {
  FORMAT_MISMATCH_WARNING,
  isNearOutputAspectRatio,
  type OutputAspectRatio,
} from "@/lib/output-format";
import { PRIORITY_CANDIDATE_COUNT } from "@/lib/review";
import {
  buildSlackCandidateBlocks,
  buildSlackCandidateDeliveryFailedText,
  validateSlackCandidateBlocks,
  type SlackBlock,
} from "@/lib/slack-blocks";
import { resolveSlackImageUrl } from "@/lib/slack-image-url";
import { postSlackMessage, SlackPostMessageError } from "@/lib/slack";
import {
  reviewCandidateKeyboard,
  sendMessage,
  sendPhoto,
} from "@/lib/telegram";

/** Progress / status text for a conversation on either chat platform. */
export const notifyConversation = async (
  conversation: ChatConversation,
  text: string,
  options?: { blocks?: SlackBlock[] },
): Promise<void> => {
  if (conversation.platform === CHAT_PLATFORM.telegram) {
    await sendMessage(requireTelegramConversation(conversation), text);
    return;
  }
  if (conversation.platform === CHAT_PLATFORM.slack) {
    await postSlackMessage({
      channel: requireSlackConversation(conversation),
      text,
      ...(options?.blocks ? { blocks: options.blocks } : {}),
    });
    return;
  }
  throw new Error(`Unsupported chat platform: ${(conversation as ChatConversation).platform}`);
};

const candidateBlocksHaveReviewActions = (blocks: SlackBlock[]): boolean =>
  blocks.some(
    (block) =>
      block.type === "actions" &&
      Array.isArray(block.elements) &&
      (block.elements as Array<{ action_id?: string }>).some(
        (element) =>
          element.action_id === "ss_cand_approve" || element.action_id === "ss_cand_reject",
      ),
  );

const stripImageBlocks = (blocks: SlackBlock[]): SlackBlock[] =>
  blocks.filter((block) => block.type !== "image");

/**
 * Compare delivered pixels to the campaign ratio.
 * Mismatch → warning only (still deliver). Unreadable → no warning (file already paid/valid path).
 */
export const evaluateOutputFormatMatch = async (params: {
  blobUrl: string;
  expectedAspectRatio?: OutputAspectRatio;
  fetchDimensions?: typeof fetchImageDimensions;
}): Promise<{ formatWarning: string | null }> => {
  if (!params.expectedAspectRatio) {
    return { formatWarning: null };
  }
  const fetchDims = params.fetchDimensions ?? fetchImageDimensions;
  const dims = await fetchDims(params.blobUrl);
  if (!dims) {
    console.error("[generation-delivery/format]", "could not read image dimensions", {
      expectedAspectRatio: params.expectedAspectRatio,
      // Host/path only — never tokens or query secrets.
      imageHost: (() => {
        try {
          return new URL(params.blobUrl).host;
        } catch {
          return "invalid-url";
        }
      })(),
    });
    return { formatWarning: null };
  }

  const matches = isNearOutputAspectRatio(
    dims.width,
    dims.height,
    params.expectedAspectRatio,
  );
  console.info("[generation-delivery/format]", {
    expectedAspectRatio: params.expectedAspectRatio,
    actualWidth: dims.width,
    actualHeight: dims.height,
    matches,
  });

  if (matches) {
    return { formatWarning: null };
  }
  return { formatWarning: FORMAT_MISMATCH_WARNING };
};

/**
 * Deliver a ready candidate image with platform-appropriate review controls.
 * Slack presentation failures are returned as null message ids — they must not
 * roll back persisted candidate rows or trigger paid regeneration.
 */
export const deliverCandidateImage = async (params: {
  conversation: ChatConversation;
  blobUrl: string;
  caption: string;
  candidateId: string;
  sku: string;
  candidateIndex: number;
  expectedAspectRatio?: OutputAspectRatio;
}): Promise<{ externalMessageId: string | null; deliveryError?: string }> => {
  const { formatWarning } = await evaluateOutputFormatMatch({
    blobUrl: params.blobUrl,
    expectedAspectRatio: params.expectedAspectRatio,
  });
  const caption = formatWarning
    ? `${params.caption}\n\n${formatWarning}`
    : params.caption;

  if (params.conversation.platform === CHAT_PLATFORM.telegram) {
    const message = await sendPhoto(
      requireTelegramConversation(params.conversation),
      params.blobUrl,
      caption,
      reviewCandidateKeyboard(params.candidateId),
    );
    return { externalMessageId: toExternalMessageId(message.message_id) };
  }

  if (params.conversation.platform === CHAT_PLATFORM.slack) {
    const channel = requireSlackConversation(params.conversation);
    const slackImageUrl = resolveSlackImageUrl(params.blobUrl, env.appUrl);
    if (!slackImageUrl) {
      console.error(
        "[generation-delivery/slack-candidate] image_url is not public HTTPS; " +
          "Slack cannot download it. Set APP_URL to the current public ngrok origin. " +
          `blobUrl=${params.blobUrl}`,
      );
    }

    const built = buildSlackCandidateBlocks({
      caption,
      blobUrl: slackImageUrl ?? params.blobUrl,
      candidateId: params.candidateId,
      sku: params.sku,
      candidateIndex: params.candidateIndex,
      total: PRIORITY_CANDIDATE_COUNT,
      testMode: isFakeImageGenerationProvider(),
      formatWarning,
    });

    if (!candidateBlocksHaveReviewActions(built.blocks)) {
      const message =
        "Candidate Block Kit missing Approve/Reject actions; refusing unreviewable delivery";
      console.error("[generation-delivery/slack-candidate]", message);
      return { externalMessageId: null, deliveryError: message };
    }

    const blockProblems = validateSlackCandidateBlocks(built.blocks);
    const blocksForFirstAttempt =
      blockProblems.length === 0 ? built.blocks : stripImageBlocks(built.blocks);
    if (blockProblems.length > 0) {
      console.error(
        "[generation-delivery/slack-candidate] Block Kit image validation failed; " +
          "posting Approve/Reject without image.",
        blockProblems,
      );
    }

    const tryPost = async (blocks: SlackBlock[]) =>
      postSlackMessage({
        channel,
        text: built.text,
        blocks,
        invalidBlocksFallback: "none",
      });

    try {
      const posted = await tryPost(blocksForFirstAttempt);
      return { externalMessageId: posted.ts ?? null };
    } catch (error) {
      const firstMessage =
        error instanceof SlackPostMessageError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Slack candidate delivery failed";
      // Log Slack error + validation messages only — never tokens or response_url.
      if (error instanceof SlackPostMessageError) {
        console.error(
          "[generation-delivery/slack-candidate]",
          firstMessage,
          {
            slackError: error.slackError,
            validationMessages: error.validationMessages,
            imageUrl: slackImageUrl ?? params.blobUrl,
          },
        );
      } else {
        console.error("[generation-delivery/slack-candidate]", firstMessage);
      }

      // Image URL fetch failures often invalidate the whole message. Retry without
      // the image block so Approve/Reject remain deliverable.
      const withoutImage = stripImageBlocks(built.blocks);
      if (
        withoutImage.length > 0 &&
        withoutImage.length < built.blocks.length &&
        candidateBlocksHaveReviewActions(withoutImage)
      ) {
        try {
          const posted = await tryPost(withoutImage);
          console.error(
            "[generation-delivery/slack-candidate] delivered review actions without image after invalid_blocks",
          );
          return { externalMessageId: posted.ts ?? null };
        } catch (retryError) {
          const retryMessage =
            retryError instanceof SlackPostMessageError
              ? retryError.message
              : retryError instanceof Error
                ? retryError.message
                : "Slack candidate delivery failed without image";
          console.error("[generation-delivery/slack-candidate]", retryMessage);
        }
      }

      // Do not pretend the candidate is reviewable — explain that controls failed.
      const failureText = buildSlackCandidateDeliveryFailedText({
        sku: params.sku,
        candidateIndex: params.candidateIndex,
        total: PRIORITY_CANDIDATE_COUNT,
      });
      try {
        await postSlackMessage({
          channel,
          text: failureText,
          invalidBlocksFallback: "none",
        });
      } catch (notifyError) {
        console.error(
          "[generation-delivery/slack-candidate]",
          notifyError instanceof Error ? notifyError.message : "failure notice failed",
        );
      }

      return { externalMessageId: null, deliveryError: firstMessage };
    }
  }

  throw new Error(
    `Unsupported chat platform: ${(params.conversation as ChatConversation).platform}`,
  );
};
