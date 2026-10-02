import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCandidateInsertValues,
  isMissingGenerationAttemptsSchemaError,
  stableCandidateId,
} from "@/lib/generation";

test("missing generation_attempts schema errors are detected for production-like Postgres messages", () => {
  assert.equal(
    isMissingGenerationAttemptsSchemaError(
      new Error('relation "generation_attempts" does not exist'),
    ),
    true,
  );
  assert.equal(
    isMissingGenerationAttemptsSchemaError(
      new Error('column "generation_attempt_id" of relation "generation_candidates" does not exist'),
    ),
    true,
  );
  assert.equal(
    isMissingGenerationAttemptsSchemaError(new Error("42P01: undefined_table")),
    true,
  );
  assert.equal(
    isMissingGenerationAttemptsSchemaError(new Error("42703: undefined_column")),
    true,
  );
  assert.equal(
    isMissingGenerationAttemptsSchemaError(new Error("Slack chat.postMessage failed: invalid_blocks")),
    false,
  );
  assert.equal(
    isMissingGenerationAttemptsSchemaError(new Error("Generation abc timed out after 120000ms")),
    false,
  );
});

test("candidate inserts omit generationAttemptId when attempt persistence is skipped", () => {
  const rows = buildCandidateInsertValues({
    shotRequestId: "req-ss004",
    productSku: "SS-004",
    startIndex: 1,
    prompt: "bedside nightstand",
    platform: "slack",
    conversationId: "C_ALLOWED",
    attemptId: null,
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.candidateIndex),
    [1, 2, 3],
  );
  for (const row of rows) {
    assert.equal("generationAttemptId" in row, false);
    assert.equal(row.id, stableCandidateId("req-ss004", row.candidateIndex));
    assert.equal(row.status, "pending");
  }
});

test("candidate inserts include generationAttemptId when attempt row was persisted", () => {
  const rows = buildCandidateInsertValues({
    shotRequestId: "req-ss002",
    productSku: "SS-002",
    startIndex: 4,
    prompt: "evening coffee table",
    platform: "slack",
    conversationId: "C_ALLOWED",
    attemptId: "attempt-linked-1",
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.candidateIndex),
    [4, 5, 6],
  );
  assert.ok(rows.every((row) => row.generationAttemptId === "attempt-linked-1"));
});

test("regression: missing attempts schema must not be treated as a Luma generation failure", () => {
  // Production (ep-red-voice) after history deploy, migration 0005 not applied:
  // - SS-004 bffc96dc… → failed 2026-10-02T17:00Z with 0 candidates (never reached Luma)
  // - SS-002 a39d8b79… → failed 2026-10-02T18:08Z with only Sept 29 candidates (no new attempt)
  // Root cause 1: insert into generation_attempts threw; catch marked the request failed.
  // Root cause 2 (after soft-skip): drizzle candidate insert still emits generation_attempt_id
  // as DEFAULT because the column is on the schema, which 42703s when the column is absent.
  const schemaError = new Error('relation "generation_attempts" does not exist');
  assert.equal(isMissingGenerationAttemptsSchemaError(schemaError), true);
  assert.equal(
    isMissingGenerationAttemptsSchemaError(
      new Error('column "generation_attempt_id" of relation "generation_candidates" does not exist'),
    ),
    true,
  );

  const rows = buildCandidateInsertValues({
    shotRequestId: "bffc96dc-e183-f923-8a57-5f1306654875",
    productSku: "SS-004",
    startIndex: 1,
    prompt: "bedside nightstand at dusk, lamp on",
    platform: "slack",
    conversationId: "C_PROD",
    attemptId: null,
  });

  // After skipping attempt persistence, candidate rows must be insertable via the
  // pre-migration SQL path (insertCandidateRows with linkAttemptId:false) that does
  // not mention generation_attempt_id.
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => !("generationAttemptId" in row)));
  assert.ok(rows.every((row) => row.productSku === "SS-004"));
});
