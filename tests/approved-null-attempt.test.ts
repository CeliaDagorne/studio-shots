import assert from "node:assert/strict";
import test from "node:test";

import { LEGACY_GENERATION_LABEL } from "@/lib/generation-attempts";
import {
  countApprovedGalleryImages,
  excludeForeignSkuDemoUrls,
  filterApprovedCandidates,
  historyViewsIncludingLegacyUnlinked,
} from "@/lib/products";

test("approved gallery keeps ready+approved+blob candidates even when generation_attempt_id is null", () => {
  const ss004Rows = [
    {
      id: "ss004-1",
      candidateIndex: 1,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://blob.example/ss-004-1.jpg",
      blobPath: "candidates/SS-004/1.jpg",
    },
    {
      id: "ss004-2",
      candidateIndex: 2,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://blob.example/ss-004-2.jpg",
      blobPath: "candidates/SS-004/2.jpg",
    },
    {
      id: "ss004-3",
      candidateIndex: 3,
      status: "ready",
      reviewDecision: "rejected",
      blobUrl: "https://blob.example/ss-004-3.jpg",
      blobPath: "candidates/SS-004/3.jpg",
    },
    {
      id: "ss004-no-blob",
      candidateIndex: 4,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: null,
      blobPath: null,
    },
  ];

  const approved = filterApprovedCandidates(ss004Rows);
  assert.deepEqual(
    approved.map((row) => row.id),
    ["ss004-1", "ss004-2"],
  );
  assert.equal(countApprovedGalleryImages(ss004Rows), 2);
});

test("campaign and product share the same approved-image counting rules", () => {
  const rows = [
    {
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://blob.example/a.jpg",
    },
    {
      status: "ready",
      reviewDecision: "approved",
      blobUrl: null,
    },
    {
      status: "ready",
      reviewDecision: "rejected",
      blobUrl: "https://blob.example/c.jpg",
    },
  ];

  assert.equal(countApprovedGalleryImages(rows), 1);
});

test("SS-004 approved gallery stays scoped to that SKU and never mixes foreign candidates", () => {
  const scoped = excludeForeignSkuDemoUrls("SS-004", [
    {
      id: "ss004-1",
      candidateIndex: 1,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://blob.example/ss-004-1.jpg",
      blobPath: "candidates/SS-004/1.jpg",
      productSku: "SS-004",
    },
    {
      id: "ss004-2",
      candidateIndex: 2,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://blob.example/ss-004-2.jpg",
      blobPath: "candidates/SS-004/2.jpg",
      productSku: "SS-004",
    },
    {
      id: "foreign-demo",
      candidateIndex: 1,
      status: "ready",
      reviewDecision: "approved",
      blobUrl: "https://studio-shots.example/demo/ss-001-lilac-vase.png",
      blobPath: "candidates/SS-001/1.jpg",
      productSku: "SS-004",
    },
  ]);

  const approved = filterApprovedCandidates(scoped);
  assert.equal(approved.length, 2);
  assert.deepEqual(
    approved.map((row) => row.id),
    ["ss004-1", "ss004-2"],
  );
  assert.ok(approved.every((row) => !row.blobUrl.includes("ss-001")));
});

test("null generation_attempt_id candidates appear as Legacy generation on history", () => {
  const photoUrl = "https://blob.example/ss-004.jpg";
  const attempts = historyViewsIncludingLegacyUnlinked({
    storedAttempts: [],
    productPhotoUrl: photoUrl,
    shotRequestId: "req-ss004",
    sku: "SS-004",
    shotIdea: "nightstand",
    candidates: [
      {
        id: "c1",
        candidateIndex: 1,
        status: "ready",
        reviewDecision: "approved",
        blobUrl: photoUrl,
        errorMessage: null,
        lumaGenerationId: "g1",
        externalMessageId: "m1",
        createdAt: new Date("2026-10-01T10:00:00Z"),
        generationAttemptId: null,
      },
      {
        id: "c2",
        candidateIndex: 2,
        status: "ready",
        reviewDecision: "approved",
        blobUrl: photoUrl,
        errorMessage: null,
        lumaGenerationId: "g2",
        externalMessageId: "m2",
        createdAt: new Date("2026-10-01T10:00:01Z"),
        generationAttemptId: null,
      },
      {
        id: "c3",
        candidateIndex: 3,
        status: "ready",
        reviewDecision: "rejected",
        blobUrl: photoUrl,
        errorMessage: null,
        lumaGenerationId: "g3",
        externalMessageId: "m3",
        createdAt: new Date("2026-10-01T10:00:02Z"),
        generationAttemptId: null,
      },
    ],
  });

  assert.equal(attempts.length, 1);
  assert.notEqual(attempts.length, 0);
  assert.equal(attempts[0]?.label, LEGACY_GENERATION_LABEL);
  assert.equal(attempts[0]?.isLegacy, true);
  assert.equal(attempts[0]?.attemptNumber, null);
  assert.deepEqual(
    attempts[0]?.candidates.map((c) => c.displayIndex),
    [1, 2, 3],
  );
});

test("unlinked candidates still form a Legacy group beside stored attempts", () => {
  const photoUrl = "https://blob.example/ss-004.jpg";
  const attempts = historyViewsIncludingLegacyUnlinked({
    storedAttempts: [
      {
        id: "attempt-2",
        attemptNumber: 2,
        isLegacy: false,
        shotIdea: "nightstand",
        aspectRatio: "4:5",
        environment: "luma",
        status: "completed",
        errorMessage: null,
        createdAt: new Date("2026-10-02T12:00:00Z"),
      },
    ],
    productPhotoUrl: photoUrl,
    shotRequestId: "req-ss004",
    sku: "SS-004",
    shotIdea: "nightstand",
    candidates: [
      {
        id: "legacy-1",
        candidateIndex: 1,
        status: "ready",
        reviewDecision: "approved",
        blobUrl: photoUrl,
        errorMessage: null,
        lumaGenerationId: "g1",
        externalMessageId: "m1",
        createdAt: new Date("2026-10-01T10:00:00Z"),
        generationAttemptId: null,
      },
      {
        id: "linked-4",
        candidateIndex: 4,
        status: "ready",
        reviewDecision: "approved",
        blobUrl: photoUrl,
        errorMessage: null,
        lumaGenerationId: "g4",
        externalMessageId: "m4",
        createdAt: new Date("2026-10-02T12:00:00Z"),
        generationAttemptId: "attempt-2",
      },
    ],
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.label, "Attempt 2");
  assert.equal(attempts[1]?.label, LEGACY_GENERATION_LABEL);
  assert.equal(attempts[1]?.isLegacy, true);
});
