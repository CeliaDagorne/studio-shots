import assert from "node:assert/strict";
import test from "node:test";

process.env.APP_URL = process.env.APP_URL ?? "https://studio-shots.example";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://example";
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "telegram-token";
process.env.TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET ?? "telegram-secret";
process.env.ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID ?? "-1001";
process.env.LUMA_AGENTS_API_KEY = process.env.LUMA_AGENTS_API_KEY ?? "luma-key";
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "xoxb-test-token";
process.env.SLACK_SIGNING_SECRET =
  process.env.SLACK_SIGNING_SECRET ?? "slack-signing-secret-for-tests";
process.env.SLACK_TEAM_ID = process.env.SLACK_TEAM_ID ?? "T_ALLOWED";
process.env.SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID ?? "C_ALLOWED";
process.env.IMAGE_GENERATION_PROVIDER = "fake";

test("fake candidates include Approve and Reject with production action IDs", async () => {
  const { buildSlackCandidateBlocks, SLACK_ACTION_IDS } = await import(
    "@/lib/slack-blocks"
  );
  const { candidateCaption } = await import("@/lib/review");

  const built = buildSlackCandidateBlocks({
    caption: candidateCaption({ sku: "SS-001", index: 1, total: 3 }),
    blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
    candidateId: "cand-fake-1",
    sku: "SS-001",
    candidateIndex: 1,
    total: 3,
    testMode: true,
  });

  const serialized = JSON.stringify(built.blocks);
  assert.match(serialized, new RegExp(SLACK_ACTION_IDS.approve));
  assert.match(serialized, new RegExp(SLACK_ACTION_IDS.reject));
  assert.match(serialized, /Approve/);
  assert.match(serialized, /Reject/);
  assert.match(serialized, /cand-fake-1/);
  assert.match(built.text, /Test candidate/);
});

test("candidate delivery retries without image and never falls back to unreviewable plain text", async () => {
  const { deliverCandidateImage } = await import("@/lib/generation-delivery");
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const { slackConversation } = await import("@/lib/chat-identity");

  let postCount = 0;
  const bodies: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    postCount += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    bodies.push(body);
    if (postCount === 1) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "invalid_blocks",
          response_metadata: {
            messages: ["[ERROR] downloading image failed"],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true, ts: "999.111" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await deliverCandidateImage({
      conversation: slackConversation("C_ALLOWED"),
      blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
      caption: "SS-001 candidate 1/3\nReview this candidate independently.",
      candidateId: "cand-retry-1",
      sku: "SS-001",
      candidateIndex: 1,
    });
    assert.equal(result.externalMessageId, "999.111");
    assert.equal(result.deliveryError, undefined);
    assert.equal(postCount, 2);
    assert.ok(Array.isArray(bodies[0]?.blocks));
    assert.ok(Array.isArray(bodies[1]?.blocks));
    const retryBlocks = JSON.stringify(bodies[1]?.blocks);
    assert.match(retryBlocks, new RegExp(SLACK_ACTION_IDS.approve));
    assert.match(retryBlocks, new RegExp(SLACK_ACTION_IDS.reject));
    assert.doesNotMatch(retryBlocks, /"type":"image"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("when review actions cannot be delivered, fallback explains controls failed", async () => {
  const { deliverCandidateImage } = await import("@/lib/generation-delivery");
  const { slackConversation } = await import("@/lib/chat-identity");

  let postCount = 0;
  const texts: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    postCount += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    texts.push(String(body.text ?? ""));
    return new Response(
      JSON.stringify({
        ok: false,
        error: "invalid_blocks",
        response_metadata: { messages: ["[ERROR] invalid actions"] },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const result = await deliverCandidateImage({
      conversation: slackConversation("C_ALLOWED"),
      blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
      caption: "SS-001 candidate 1/3\nReview this candidate independently.",
      candidateId: "cand-fail-1",
      sku: "SS-001",
      candidateIndex: 1,
    });
    assert.equal(result.externalMessageId, null);
    assert.ok(result.deliveryError);
    assert.ok(postCount >= 2);
    assert.ok(
      texts.some((text) => /Review controls could not be delivered/i.test(text)),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generation failure Block Kit stays retryable without auto-generating", async () => {
  const {
    buildSlackGenerationFailedBlocks,
    SLACK_ACTION_IDS,
    encodeSlackGenValue,
  } = await import("@/lib/slack-blocks");

  const built = buildSlackGenerationFailedBlocks({
    sku: "SS-001",
    importId: "import-1",
    requestId: "req-1",
    campaignPageUrl: "https://studio-shots.example/campaigns/import-1",
    testMode: true,
  });

  assert.match(built.text, /⚠️ Generation failed for SS-001/);
  const serialized = JSON.stringify(built.blocks);
  assert.match(serialized, /Retry SS-001/);
  assert.match(serialized, /Choose another product/);
  assert.match(serialized, /View campaign/);
  assert.match(serialized, new RegExp(SLACK_ACTION_IDS.retry));
  assert.match(serialized, new RegExp(encodeSlackGenValue("import-1", "req-1", "SS-001")));
  assert.doesNotMatch(serialized, /Campaign complete/);
});

test("needs_regeneration Block Kit offers manual regenerate with cost in paid mode", async () => {
  const {
    buildSlackProductResolutionBlocks,
    SLACK_ACTION_IDS,
  } = await import("@/lib/slack-blocks");

  const fake = buildSlackProductResolutionBlocks({
    outcome: "needs_regeneration",
    sku: "SS-001",
    approvalCount: 0,
    productPageUrl: "https://studio-shots.example/products/SS-001",
    campaignPageUrl: "https://studio-shots.example/campaigns/import-1",
    importId: "import-1",
    requestId: "req-1",
    testMode: true,
  });
  assert.match(fake.text, /🔁 SS-001 still needs a usable image/);
  assert.match(JSON.stringify(fake.blocks), /Generate new test candidates/);
  assert.match(JSON.stringify(fake.blocks), new RegExp(SLACK_ACTION_IDS.retry));
  assert.doesNotMatch(JSON.stringify(fake.blocks), /Campaign complete/);

  const paid = buildSlackProductResolutionBlocks({
    outcome: "needs_regeneration",
    sku: "SS-001",
    approvalCount: 1,
    productPageUrl: "https://studio-shots.example/products/SS-001",
    campaignPageUrl: "https://studio-shots.example/campaigns/import-1",
    importId: "import-1",
    requestId: "req-1",
    testMode: false,
  });
  assert.match(JSON.stringify(paid.blocks), /Generate 3 new candidates · ~\$0\.13/);
});

test("delivery failure Block Kit resends without regenerating", async () => {
  const { buildSlackDeliveryFailedBlocks, SLACK_ACTION_IDS } = await import(
    "@/lib/slack-blocks"
  );
  const built = buildSlackDeliveryFailedBlocks({
    sku: "SS-001",
    importId: "import-1",
    requestId: "req-1",
    readyCount: 3,
    campaignPageUrl: "https://studio-shots.example/campaigns/import-1",
  });
  const serialized = JSON.stringify(built.blocks);
  assert.match(serialized, /Resend review messages/);
  assert.match(serialized, new RegExp(SLACK_ACTION_IDS.resend));
  assert.doesNotMatch(serialized, /Generate 3 new candidates/);
});

test("campaign complete only after every actionable product is approved", async () => {
  const { selectNextActionableProduct, filterActionableOptionsByStatus } = await import(
    "@/lib/product-selection"
  );
  const { WORKFLOW } = await import("@/lib/review");
  const { buildSlackProductResolutionBlocks } = await import("@/lib/slack-blocks");

  const options = [
    { requestId: "req-1", sku: "SS-001", priority: "high" as const },
    { requestId: "req-2", sku: "SS-002", priority: "normal" as const },
  ];
  const withUnresolved = filterActionableOptionsByStatus(
    options,
    new Map([
      ["req-1", { id: "req-1", productSku: "SS-001", workflowStatus: WORKFLOW.needsRegeneration }],
      ["req-2", { id: "req-2", productSku: "SS-002", workflowStatus: WORKFLOW.approved }],
    ]),
  );
  assert.equal(selectNextActionableProduct(withUnresolved)?.sku, "SS-001");

  const complete = buildSlackProductResolutionBlocks({
    outcome: "approved",
    sku: "SS-002",
    approvalCount: 2,
    productPageUrl: "https://studio-shots.example/products/SS-002",
    campaignPageUrl: "https://studio-shots.example/campaigns/import-1",
    importId: "import-1",
    nextProduct: null,
  });
  assert.match(JSON.stringify(complete.blocks), /🎉 Campaign complete/);
});

test("fake-mode approve/reject interactions use shared action IDs", async () => {
  const { handleSlackBlockAction, SLACK_INTERACTION_MESSAGES } = await import(
    "@/lib/slack-actions"
  );
  const { SLACK_ACTION_IDS } = await import("@/lib/slack-blocks");
  const { createFakeGenerationProvider } = await import("@/lib/image-generation-fake");

  // Ensure fake provider can be constructed without Luma.
  const provider = createFakeGenerationProvider({
    appUrl: "https://studio-shots.example",
    delayMs: 0,
    sleep: async () => undefined,
  });
  assert.equal(provider.name, "fake");

  const claimed = new Set<string>();
  let persistCalls = 0;

  const result = await handleSlackBlockAction(
    {
      type: "block_actions",
      trigger_id: "trig-fake-approve",
      team: { id: "T_ALLOWED" },
      channel: { id: "C_ALLOWED" },
      response_url: "https://hooks.slack.com/actions/test",
      message: {
        ts: "1.1",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*SS-001* · candidate 1/3\nReview this candidate independently.",
            },
          },
          {
            type: "actions",
            block_id: "ss_cand_actions:cand-1",
            elements: [
              {
                type: "button",
                action_id: SLACK_ACTION_IDS.approve,
                text: { type: "plain_text", text: "Approve" },
                value: "cand-1",
              },
            ],
          },
        ],
      },
      actions: [
        {
          action_id: SLACK_ACTION_IDS.approve,
          value: "cand-1",
          action_ts: "1",
        },
      ],
    },
    {
      claimAction: (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      releaseAction: () => undefined,
      getCandidateById: async () =>
        ({
          id: "cand-1",
          shotRequestId: "req-1",
          productSku: "SS-001",
          candidateIndex: 1,
          status: "ready",
          reviewDecision: null,
          blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
          platform: "slack",
          conversationId: "C_ALLOWED",
        }) as never,
      persistCandidateReview: async () => {
        persistCalls += 1;
        return {
          alreadyReviewed: false,
          candidate: {
            id: "cand-1",
            shotRequestId: "req-1",
            productSku: "SS-001",
            candidateIndex: 1,
            status: "ready",
            reviewDecision: "approved",
            blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
            platform: "slack",
            conversationId: "C_ALLOWED",
          } as never,
          existingDecision: "approved",
          requestStatus: "awaiting_review",
          approvedCount: null,
          importId: "import-1",
          newlyResolved: false,
        };
      },
      postResponseUrl: async () => undefined,
      isFakeGeneration: () => true,
    },
  );

  assert.equal(result.httpBody.replace_original, true);
  assert.match(JSON.stringify(result.httpBody.blocks), /Approved/);
  assert.ok(result.background);
  await result.background!();
  assert.equal(persistCalls, 1);
  assert.equal(SLACK_INTERACTION_MESSAGES.unknownAction.length > 0, true);
});

test("failed and needs_regeneration stay claimable; in-flight and approved do not", async () => {
  const { WORKFLOW } = await import("@/lib/review");
  const { isActionableWorkflowStatus } = await import("@/lib/request-planning");

  assert.equal(isActionableWorkflowStatus(WORKFLOW.failed), true);
  assert.equal(isActionableWorkflowStatus(WORKFLOW.needsRegeneration), true);
  assert.equal(isActionableWorkflowStatus(WORKFLOW.importedUnconfirmed), true);
  assert.equal(isActionableWorkflowStatus(WORKFLOW.generating), false);
  assert.equal(isActionableWorkflowStatus(WORKFLOW.awaitingReview), false);
  assert.equal(isActionableWorkflowStatus(WORKFLOW.approved), false);
});

test("interactivity endpoint path remains /api/slack/interactions", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(
    existsSync(
      new URL("../src/app/api/slack/interactions/route.ts", import.meta.url),
    ),
    true,
  );
});

test("zero Luma calls throughout fake-mode candidate block construction", async () => {
  let lumaFetch = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : (input as URL).toString?.() ?? input);
    if (/lumalabs|api\.lu\.ma|agents\.lumalabs/i.test(url)) {
      lumaFetch += 1;
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    process.env.IMAGE_GENERATION_PROVIDER = "fake";
    const { resetImageGenerationProviderForTests } = await import(
      "@/lib/image-generation-provider"
    );
    resetImageGenerationProviderForTests();
    const { createFakeGenerationProvider } = await import("@/lib/image-generation-fake");
    const { runCandidateImagePipeline } = await import("@/lib/candidate-pipeline");
    const { buildSlackCandidateBlocks, SLACK_ACTION_IDS } = await import(
      "@/lib/slack-blocks"
    );

    const provider = createFakeGenerationProvider({
      appUrl: "https://studio-shots.example",
      delayMs: 0,
      sleep: async () => undefined,
    });
    assert.equal(provider.name, "fake");

    const result = await runCandidateImagePipeline(provider, {
      candidateId: "cand-zero-luma",
      candidateIndex: 1,
      productSku: "SS-001",
      photoUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
      prompt: "editorial",
    });
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      const built = buildSlackCandidateBlocks({
        caption: "cap",
        blobUrl: result.blobUrl,
        candidateId: "cand-zero-luma",
        sku: "SS-001",
        candidateIndex: 1,
        total: 3,
        testMode: true,
      });
      assert.match(JSON.stringify(built.blocks), new RegExp(SLACK_ACTION_IDS.approve));
    }
    assert.equal(lumaFetch, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
