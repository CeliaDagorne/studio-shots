import {
  CHAT_PLATFORM,
  requireSlackConversation,
  requireTelegramConversation,
  toExternalMessageId,
  type ChatConversation,
} from "@/lib/chat-identity";
import { isFakeImageGenerationProvider } from "@/lib/image-generation";
import { PRIORITY_CANDIDATE_COUNT } from "@/lib/review";
import {
  buildSlackCandidateBlocks,
  buildSlackCandidateDeliveryFailedText,
  type SlackBlock,
} from "@/lib/slack-blocks";
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
}): Promise<{ externalMessageId: string | null; deliveryError?: string }> => {
  if (params.conversation.platform === CHAT_PLATFORM.telegram) {
    const message = await sendPhoto(
      requireTelegramConversation(params.conversation),
      params.blobUrl,
      params.caption,
      reviewCandidateKeyboard(params.candidateId),
    );
    return { externalMessageId: toExternalMessageId(message.message_id) };
  }

  if (params.conversation.platform === CHAT_PLATFORM.slack) {
    const channel = requireSlackConversation(params.conversation);
    const built = buildSlackCandidateBlocks({
      caption: params.caption,
      blobUrl: params.blobUrl,
      candidateId: params.candidateId,
      sku: params.sku,
      candidateIndex: params.candidateIndex,
      total: PRIORITY_CANDIDATE_COUNT,
      testMode: isFakeImageGenerationProvider(),
    });

    if (!candidateBlocksHaveReviewActions(built.blocks)) {
      const message =
        "Candidate Block Kit missing Approve/Reject actions; refusing unreviewable delivery";
      console.error("[generation-delivery/slack-candidate]", message);
      return { externalMessageId: null, deliveryError: message };
    }

    const tryPost = async (blocks: SlackBlock[]) =>
      postSlackMessage({
        channel,
        text: built.text,
        blocks,
        invalidBlocksFallback: "none",
      });

    try {
      const posted = await tryPost(built.blocks);
      return { externalMessageId: posted.ts ?? null };
    } catch (error) {
      const firstMessage =
        error instanceof SlackPostMessageError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Slack candidate delivery failed";
      console.error("[generation-delivery/slack-candidate]", firstMessage);

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
