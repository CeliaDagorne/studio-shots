import {
  CHAT_PLATFORM,
  requireSlackConversation,
  requireTelegramConversation,
  toExternalMessageId,
  type ChatConversation,
} from "@/lib/chat-identity";
import { isFakeImageGenerationProvider } from "@/lib/image-generation";
import { PRIORITY_CANDIDATE_COUNT } from "@/lib/review";
import { buildSlackCandidateBlocks, type SlackBlock } from "@/lib/slack-blocks";
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

/**
 * Deliver a ready candidate image with platform-appropriate review controls.
 * Slack presentation failures are returned as null message ids — they must not
 * roll back persisted candidate rows.
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
    const built = buildSlackCandidateBlocks({
      caption: params.caption,
      blobUrl: params.blobUrl,
      candidateId: params.candidateId,
      sku: params.sku,
      candidateIndex: params.candidateIndex,
      total: PRIORITY_CANDIDATE_COUNT,
      testMode: isFakeImageGenerationProvider(),
    });
    try {
      const posted = await postSlackMessage({
        channel: requireSlackConversation(params.conversation),
        text: built.text,
        blocks: built.blocks,
      });
      return { externalMessageId: posted.ts ?? null };
    } catch (error) {
      const message =
        error instanceof SlackPostMessageError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Slack candidate delivery failed";
      console.error("[generation-delivery/slack-candidate]", message);
      return { externalMessageId: null, deliveryError: message };
    }
  }

  throw new Error(`Unsupported chat platform: ${params.conversation.platform}`);
};
