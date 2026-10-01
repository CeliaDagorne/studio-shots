import test from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_STATUS,
  REVIEW_DECISION,
  WORKFLOW,
  candidateCaption,
  resolveRequestAfterReviews,
} from "@/lib/review";
import { candidateBlobPath } from "@/lib/blob";
import { buildImageEditCreateParams, buildImageEditPrompt } from "@/lib/luma";
import { importPreviewKeyboard, reviewCandidateKeyboard } from "@/lib/telegram";
import { requestPlanFromCounts } from "@/lib/request-planning";

test("resolveRequestAfterReviews stays awaiting until every ready candidate is reviewed", () => {
  const resolution = resolveRequestAfterReviews([
    { status: CANDIDATE_STATUS.ready, reviewDecision: REVIEW_DECISION.approved },
    { status: CANDIDATE_STATUS.ready, reviewDecision: null },
    { status: CANDIDATE_STATUS.failed, reviewDecision: null },
  ]);
  assert.equal(resolution.status, WORKFLOW.awaitingReview);
});

test("resolveRequestAfterReviews marks approved at two or more approvals", () => {
  const resolution = resolveRequestAfterReviews([
    { status: CANDIDATE_STATUS.ready, reviewDecision: REVIEW_DECISION.approved },
    { status: CANDIDATE_STATUS.ready, reviewDecision: REVIEW_DECISION.approved },
    { status: CANDIDATE_STATUS.ready, reviewDecision: REVIEW_DECISION.rejected },
  ]);
  assert.equal(resolution.status, WORKFLOW.approved);
  if (resolution.status === WORKFLOW.approved) {
    assert.equal(resolution.approvedCount, 2);
  }
});

test("resolveRequestAfterReviews marks needs_regeneration below two approvals", () => {
  const resolution = resolveRequestAfterReviews([
    { status: CANDIDATE_STATUS.ready, reviewDecision: REVIEW_DECISION.approved },
    { status: CANDIDATE_STATUS.ready, reviewDecision: REVIEW_DECISION.rejected },
    { status: CANDIDATE_STATUS.failed, reviewDecision: null },
  ]);
  assert.equal(resolution.status, WORKFLOW.needsRegeneration);
  if (resolution.status === WORKFLOW.needsRegeneration) {
    assert.equal(resolution.approvedCount, 1);
  }
});

test("importPreviewKeyboard shows priority, choose, and cancel actions", () => {
  const summary = requestPlanFromCounts({
    importId: "imp-1",
    totalCatalogRows: 40,
    rowsWithShotIdea: 16,
    newRequests: 0,
    changedRequests: 0,
    unchangedExistingRequests: 16,
    existingPendingRequests: 16,
    warnings: [],
    priorityRequestSku: "SS-001",
    priorityRequestPriority: "high",
  });
  const keyboard = importPreviewKeyboard(summary.importId, summary);
  assert.ok(keyboard);
  assert.equal(keyboard.inline_keyboard.length, 3);
  assert.equal(keyboard.inline_keyboard[0]?.[0]?.text, "Generate priority: SS-001 · ~$0.13");
  assert.equal(keyboard.inline_keyboard[1]?.[0]?.text, "Choose a product");
  assert.equal(keyboard.inline_keyboard[2]?.[0]?.text, "Cancel");
});

test("reviewCandidateKeyboard exposes independent approve and reject actions", () => {
  const keyboard = reviewCandidateKeyboard("cand-1");
  assert.equal(keyboard.inline_keyboard[0]?.length, 2);
  assert.match(keyboard.inline_keyboard[0]?.[0]?.callback_data ?? "", /cand:approve:cand-1/);
  assert.match(keyboard.inline_keyboard[0]?.[1]?.callback_data ?? "", /cand:reject:cand-1/);
});

test("candidate blob path follows candidates/{sku}/{candidateId}.jpg", () => {
  assert.equal(candidateBlobPath("SS-001", "abc"), "candidates/SS-001/abc.jpg");
});

test("buildImageEditPrompt keeps Shot Idea and product framing constraints", () => {
  const prompt = buildImageEditPrompt({
    shotIdea: "sunlit console table by a window, soft morning light",
  });
  assert.match(prompt, /^sunlit console table by a window, soft morning light\n\n/);
  assert.match(prompt, /Preserve the exact product from the source image/);
  assert.match(prompt, /Keep the complete product visible inside the frame/);
  assert.match(prompt, /60–75%/);
  assert.match(prompt, /Leave a clear safe margin around every edge/);
  assert.match(prompt, /Do not crop, obscure, redesign or replace/);
  assert.match(prompt, /Build the requested lifestyle environment around the product/);
  assert.match(prompt, /Avoid large empty areas and plain white backgrounds/);
  assert.match(prompt, /Props may support the scene but must never cover the product/);
});

test("buildImageEditCreateParams uses image_edit with catalog photo as source", () => {
  const prompt = buildImageEditPrompt({
    shotIdea: "evening coffee table, warm lamplight",
  });
  const photoUrl = "https://studio-shots.example/demo/ss-001-lilac-vase.png";
  const body = buildImageEditCreateParams({ prompt, photoUrl });

  assert.equal(body.type, "image_edit");
  assert.equal(body.model, "uni-1");
  assert.equal(body.output_format, "jpeg");
  assert.equal(body.prompt, prompt);
  assert.deepEqual(body.source, { url: photoUrl });
  assert.equal("image_ref" in body, false);
  assert.equal(body.image_ref, undefined);
  assert.equal("aspect_ratio" in body, false);
  assert.equal(body.aspect_ratio, undefined);
});

test("candidateCaption reflects review state", () => {
  assert.match(
    candidateCaption({ sku: "SS-001", index: 1, total: 3, reviewDecision: "approved" }),
    /Approved/,
  );
  assert.match(
    candidateCaption({ sku: "SS-001", index: 2, total: 3, reviewDecision: "rejected" }),
    /Rejected/,
  );
});
