import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_GENERATION_LABEL,
  expectedIndexesForAttempt,
  isUnambiguousAttemptBatch,
  planAttemptBackfillForRequest,
  stableGenerationAttemptId,
  stableLegacyGenerationAttemptId,
} from "@/lib/generation-attempts";

const baseCandidate = (overrides: {
  id: string;
  candidateIndex: number;
  status?: string;
  reviewDecision?: string | null;
  blobUrl?: string | null;
  errorMessage?: string | null;
  lumaGenerationId?: string | null;
  generationAttemptId?: string | null;
  createdAt?: Date;
}) => ({
  id: overrides.id,
  shotRequestId: "req-1",
  productSku: "SS-001",
  candidateIndex: overrides.candidateIndex,
  status: overrides.status ?? "ready",
  reviewDecision: overrides.reviewDecision ?? null,
  blobUrl: overrides.blobUrl ?? "/demo/ss-001-lilac-vase.png",
  errorMessage: overrides.errorMessage ?? null,
  lumaGenerationId: overrides.lumaGenerationId ?? "gen",
  createdAt: overrides.createdAt ?? new Date("2026-10-01T10:00:00Z"),
  generationAttemptId: overrides.generationAttemptId ?? null,
});

test("expected attempt batches stay on the historical candidate_index key", () => {
  assert.deepEqual(expectedIndexesForAttempt(1), [1, 2, 3]);
  assert.deepEqual(expectedIndexesForAttempt(2), [4, 5, 6]);
  assert.equal(isUnambiguousAttemptBatch(1, [1, 2, 3]), true);
  assert.equal(isUnambiguousAttemptBatch(2, [4, 5]), true);
  assert.equal(isUnambiguousAttemptBatch(1, [1, 5]), false);
});

test("backfill plans numbered attempts when candidate_index batches are unambiguous", () => {
  const planned = planAttemptBackfillForRequest({
    shotRequestId: "req-1",
    productSku: "SS-001",
    shotIdea: "sunlit console",
    productPhotoUrl: "/demo/ss-001-lilac-vase.png",
    candidates: [
      baseCandidate({ id: "c1", candidateIndex: 1, reviewDecision: "rejected" }),
      baseCandidate({ id: "c2", candidateIndex: 2, reviewDecision: "rejected" }),
      baseCandidate({ id: "c3", candidateIndex: 3, reviewDecision: "rejected" }),
      baseCandidate({
        id: "c4",
        candidateIndex: 4,
        reviewDecision: "approved",
        createdAt: new Date("2026-10-01T12:00:00Z"),
      }),
      baseCandidate({
        id: "c5",
        candidateIndex: 5,
        reviewDecision: "approved",
        createdAt: new Date("2026-10-01T12:00:00Z"),
      }),
      baseCandidate({
        id: "c6",
        candidateIndex: 6,
        reviewDecision: "rejected",
        createdAt: new Date("2026-10-01T12:00:00Z"),
      }),
    ],
  });

  assert.equal(planned.length, 2);
  assert.equal(planned[0]?.attemptNumber, 1);
  assert.equal(planned[1]?.attemptNumber, 2);
  assert.equal(planned[0]?.isLegacy, false);
  assert.equal(planned[1]?.label, "Attempt 2");
  assert.equal(planned[0]?.id, stableGenerationAttemptId("req-1", 1));
  assert.equal(planned[1]?.id, stableGenerationAttemptId("req-1", 2));
  assert.deepEqual(planned[0]?.candidateIds, ["c1", "c2", "c3"]);
  assert.deepEqual(planned[1]?.candidateIds, ["c4", "c5", "c6"]);
});

test("invalid indexes collapse into one Legacy generation without inventing numbers", () => {
  const planned = planAttemptBackfillForRequest({
    shotRequestId: "req-legacy",
    productSku: "SS-001",
    shotIdea: "sunlit console",
    productPhotoUrl: "/demo/ss-001-lilac-vase.png",
    candidates: [
      baseCandidate({ id: "a", candidateIndex: 1 }),
      baseCandidate({ id: "b", candidateIndex: 0 }),
    ],
  });

  assert.equal(planned.length, 1);
  assert.equal(planned[0]?.isLegacy, true);
  assert.equal(planned[0]?.label, LEGACY_GENERATION_LABEL);
  assert.equal(planned[0]?.attemptNumber, null);
  assert.equal(planned[0]?.id, stableLegacyGenerationAttemptId("req-legacy"));
  assert.deepEqual(planned[0]?.candidateIds, ["b", "a"]);
});

test("already-linked candidates are skipped for idempotent backfill planning", () => {
  const planned = planAttemptBackfillForRequest({
    shotRequestId: "req-1",
    productSku: "SS-001",
    shotIdea: "sunlit console",
    productPhotoUrl: "/demo/ss-001-lilac-vase.png",
    candidates: [
      baseCandidate({
        id: "c1",
        candidateIndex: 1,
        generationAttemptId: stableGenerationAttemptId("req-1", 1),
      }),
      baseCandidate({
        id: "c2",
        candidateIndex: 2,
        generationAttemptId: stableGenerationAttemptId("req-1", 1),
      }),
      baseCandidate({
        id: "c3",
        candidateIndex: 3,
        generationAttemptId: stableGenerationAttemptId("req-1", 1),
      }),
    ],
  });
  assert.deepEqual(planned, []);
});

test("stable attempt ids are deterministic", () => {
  assert.equal(
    stableGenerationAttemptId("req-1", 1),
    stableGenerationAttemptId("req-1", 1),
  );
  assert.notEqual(
    stableGenerationAttemptId("req-1", 1),
    stableGenerationAttemptId("req-1", 2),
  );
});
