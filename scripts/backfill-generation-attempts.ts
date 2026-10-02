/**
 * Idempotent backfill of generation_attempts from existing candidates.
 *
 * Dry-run (default):
 *   npx tsx scripts/backfill-generation-attempts.ts --env=.env.local
 *   npx tsx scripts/backfill-generation-attempts.ts --env=.env.production
 *
 * Write (explicit):
 *   npx tsx scripts/backfill-generation-attempts.ts --env=.env.local --write
 *
 * Do not run --write against production unless intentionally migrating that branch.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { and, eq, isNull } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { planAttemptBackfillForRequest } from "../src/lib/generation-attempts";
import {
  generationAttempts,
  generationCandidates,
  products,
  shotRequests,
} from "../src/lib/schema";

const loadEnvFile = (path: string) => {
  const contents = readFileSync(path, "utf-8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    let value = trimmed.slice(eqIdx + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

const args = process.argv.slice(2);
const envArg = args.find((arg) => arg.startsWith("--env="));
const write = args.includes("--write");

if (envArg) {
  loadEnvFile(resolve(process.cwd(), envArg.slice("--env=".length)));
} else {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const host = (() => {
    try {
      return new URL(databaseUrl).host;
    } catch {
      return "[unparseable]";
    }
  })();

  console.log(`Mode: ${write ? "WRITE" : "DRY-RUN"}`);
  console.log(`Host: ${host}`);

  const client = neon(databaseUrl);
  const db = drizzle(client);

  const columnCheck = await client`
    select 1 as ok
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'generation_candidates'
      and column_name = 'generation_attempt_id'
    limit 1
  `;
  if (columnCheck.length === 0) {
    throw new Error(
      "generation_attempt_id is missing. Apply drizzle/0005_generation_attempts.sql with npm run db:migrate before backfill.",
    );
  }

  const requests = await db
    .select({
      id: shotRequests.id,
      productSku: shotRequests.productSku,
      shotIdea: shotRequests.shotIdea,
      photoUrl: products.photoUrl,
    })
    .from(shotRequests)
    .innerJoin(products, eq(products.sku, shotRequests.productSku));

  let plannedAttempts = 0;
  let plannedLinks = 0;
  let legacyAttempts = 0;
  let skippedAlreadyLinked = 0;

  for (const request of requests) {
    const candidates = await db
      .select({
        id: generationCandidates.id,
        shotRequestId: generationCandidates.shotRequestId,
        productSku: generationCandidates.productSku,
        candidateIndex: generationCandidates.candidateIndex,
        status: generationCandidates.status,
        reviewDecision: generationCandidates.reviewDecision,
        blobUrl: generationCandidates.blobUrl,
        errorMessage: generationCandidates.errorMessage,
        lumaGenerationId: generationCandidates.lumaGenerationId,
        createdAt: generationCandidates.createdAt,
        generationAttemptId: generationCandidates.generationAttemptId,
      })
      .from(generationCandidates)
      .where(eq(generationCandidates.shotRequestId, request.id));

    const unlinked = candidates.filter((candidate) => !candidate.generationAttemptId);
    skippedAlreadyLinked += candidates.length - unlinked.length;
    if (unlinked.length === 0) {
      continue;
    }

    const planned = planAttemptBackfillForRequest({
      shotRequestId: request.id,
      productSku: request.productSku,
      shotIdea: request.shotIdea,
      productPhotoUrl: request.photoUrl,
      candidates,
    });

    if (planned.length === 0) {
      continue;
    }

    for (const attempt of planned) {
      plannedAttempts += 1;
      plannedLinks += attempt.candidateIds.length;
      if (attempt.isLegacy) {
        legacyAttempts += 1;
      }
      console.log(
        [
          attempt.isLegacy ? "LEGACY" : "ATTEMPT",
          `sku=${attempt.productSku}`,
          `request=${attempt.shotRequestId}`,
          `label=${attempt.label}`,
          `candidates=${attempt.candidateIds.length}`,
          `status=${attempt.status}`,
          `env=${attempt.environment}`,
          `id=${attempt.id}`,
        ].join(" "),
      );
    }

    if (!write) {
      continue;
    }

    for (const attempt of planned) {
      await db
        .insert(generationAttempts)
        .values({
          id: attempt.id,
          shotRequestId: attempt.shotRequestId,
          productSku: attempt.productSku,
          attemptNumber: attempt.attemptNumber,
          isLegacy: attempt.isLegacy,
          shotIdea: attempt.shotIdea,
          aspectRatio: attempt.aspectRatio,
          environment: attempt.environment,
          status: attempt.status,
          errorMessage: attempt.errorMessage,
          createdAt: attempt.createdAt,
          updatedAt: attempt.createdAt,
        })
        .onConflictDoNothing({ target: generationAttempts.id });

      for (const candidateId of attempt.candidateIds) {
        await db
          .update(generationCandidates)
          .set({ generationAttemptId: attempt.id, updatedAt: new Date() })
          .where(
            and(
              eq(generationCandidates.id, candidateId),
              isNull(generationCandidates.generationAttemptId),
            ),
          );
      }
    }
  }

  console.log("---");
  console.log(`Already linked candidates skipped: ${skippedAlreadyLinked}`);
  console.log(`Planned attempts: ${plannedAttempts} (legacy=${legacyAttempts})`);
  console.log(`Planned candidate links: ${plannedLinks}`);
  if (!write) {
    console.log("Dry-run only. Re-run with --write to persist.");
  } else {
    console.log("Write complete.");
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted]")
      : "Backfill failed",
  );
  process.exit(1);
});
