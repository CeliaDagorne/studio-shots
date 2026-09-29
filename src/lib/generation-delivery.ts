import {
  CHAT_PLATFORM,
  requireSlackConversation,
  requireTelegramConversation,
  toExternalMessageId,
  type ChatConversation,
} from "@/lib/chat-identity";
import type { SlackBlock } from "@/lib/slack-blocks";
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
 * Deliver a ready candidate image. Telegram includes live review keyboards;
 * Slack shows visual review placeholders only (actions wired in a later commit).
 */
export const deliverCandidateImage = async (params: {
  conversation: ChatConversation;
  blobUrl: string;
  caption: string;
  candidateId: string;
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
    const blocks: SlackBlock[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: params.caption },
      },
      {
        type: "image",
        image_url: params.blobUrl,
        alt_text: params.caption.slice(0, 100),
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "_Approve_ / _Reject_ controls coming soon — review stays in Telegram for now.",
          },
        ],
      },
    ];
    const posted = await postSlackMessage({
      channel: requireSlackConversation(params.conversation),
      text: params.caption,
      blocks,
    });
    return { externalMessageId: posted.ts ?? null };
  }

  throw new Error(`Unsupported chat platform: ${params.conversation.platform}`);
};
