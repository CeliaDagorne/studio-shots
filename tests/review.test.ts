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
import { buildImageRefPrompt } from "@/lib/luma";
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
  assert.equal(keyboard.inline_keyboard[0]?.[0]?.text, "Generate priority: SS-001");
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

test("buildImageRefPrompt preserves product fidelity guidance", () => {
  const prompt = buildImageRefPrompt({
    productName: "Lilac Ceramic Vase",
    colorOrFinish: "Lilac",
    material: "Stoneware",
    shotIdea: "sunlit console table by a window, soft morning light",
  });
  assert.match(prompt, /sunlit console table/);
  assert.match(prompt, /lilac stoneware lilac ceramic vase/i);
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
