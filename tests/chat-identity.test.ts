import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_PLATFORM,
  parseTelegramChatId,
  parseTelegramMessageId,
  requireTelegramConversation,
  telegramConversation,
  toExternalEventId,
  toExternalMessageId,
} from "@/lib/chat-identity";
import { stableImportId } from "@/lib/imports";

test("telegram conversation identity uses string ids", () => {
  const conversation = telegramConversation(-100123);
  assert.equal(conversation.platform, CHAT_PLATFORM.telegram);
  assert.equal(conversation.conversationId, "-100123");
  assert.equal(toExternalEventId(42), "42");
  assert.equal(toExternalMessageId(99), "99");
  assert.equal(parseTelegramChatId("-100123"), -100123);
  assert.equal(parseTelegramMessageId("99"), 99);
  assert.equal(requireTelegramConversation(conversation), -100123);
});

test("stableImportId is scoped by platform and external event id", () => {
  const telegramId = stableImportId(CHAT_PLATFORM.telegram, "100");
  const slackId = stableImportId(CHAT_PLATFORM.slack, "100");
  assert.notEqual(telegramId, slackId);
  assert.equal(stableImportId(CHAT_PLATFORM.telegram, "100"), telegramId);
});

test("requireTelegramConversation rejects unimplemented platforms", () => {
  assert.throws(
    () =>
      requireTelegramConversation({
        platform: CHAT_PLATFORM.slack,
        conversationId: "C123",
      }),
    /not implemented/,
  );
});
