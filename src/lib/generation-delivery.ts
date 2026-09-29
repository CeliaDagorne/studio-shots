import {
  CHAT_PLATFORM,
  requireSlackConversation,
  requireTelegramConversation,
  toExternalMessageId,
  type ChatConversation,
} from "@/lib/chat-identity";
import { PRIORITY_CANDIDATE_COUNT } from "@/lib/review";
import { buildSlackCandidateBlocks } from "@/lib/slack-blocks";
import { postSlackMessage } from "@/lib/slack";
import {
  reviewCandidateKeyboard,
  sendMessage,
  sendPhoto,
} from "@/lib/telegram";

/** Progress / status text for a conversation on either chat platform. */
export const notifyConversation = async (
  conversation: ChatConversation,
  text: string,
): Promise<void> => {
  if (conversation.platform === CHAT_PLATFORM.telegram) {
    await sendMessage(requireTelegramConversation(conversation), text);
    return;
  }
  if (conversation.platform === CHAT_PLATFORM.slack) {
    await postSlackMessage({
      channel: requireSlackConversation(conversation),
      text,
    });
    return;
  }
  throw new Error(`Unsupported chat platform: ${(conversation as ChatConversation).platform}`);
};

/**
 * Deliver a ready candidate image with platform-appropriate review controls.
 */
export const deliverCandidateImage = async (params: {
  conversation: ChatConversation;
  blobUrl: string;
  caption: string;
  candidateId: string;
  sku: string;
  candidateIndex: number;
}): Promise<{ externalMessageId: string | null }> => {
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
    });
    const posted = await postSlackMessage({
      channel: requireSlackConversation(params.conversation),
      text: built.text,
      blocks: built.blocks,
    });
    return { externalMessageId: posted.ts ?? null };
  }

  throw new Error(`Unsupported chat platform: ${params.conversation.platform}`);
};
