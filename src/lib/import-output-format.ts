import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db";
import {
  DEFAULT_OUTPUT_ASPECT_RATIO,
  isOutputAspectRatio,
  parseOutputAspectRatio,
  type OutputAspectRatio,
} from "@/lib/output-format";
import { generationAttempts, imports, shotRequests } from "@/lib/schema";
import type { RequestPlanSummary } from "@/types";

export const OUTPUT_FORMAT_LOCKED_MESSAGE =
  "Output format is locked because generation has already started for this campaign.";

export const OUTPUT_FORMAT_STALE_MESSAGE =
  "That format control is out of date. Output format is locked after the first generation.";

export const OUTPUT_FORMAT_INVALID_MESSAGE =
  "Choose 4:5 Portrait, 1:1 Square, or 3:2 Landscape.";

export const getImportOutputAspectRatio = async (
  importId: string,
): Promise<OutputAspectRatio> => {
  const db = getDb();
  const rows = await db
    .select({ outputAspectRatio: imports.outputAspectRatio })
    .from(imports)
    .where(eq(imports.id, importId))
    .limit(1);
  return parseOutputAspectRatio(rows[0]?.outputAspectRatio);
};

/** True once any generation_attempts row exists for shot requests in this import. */
export const isImportOutputFormatLocked = async (
  importId: string,
): Promise<boolean> => {
  const db = getDb();
  const rows = await db
    .select({ id: generationAttempts.id })
    .from(generationAttempts)
    .innerJoin(shotRequests, eq(generationAttempts.shotRequestId, shotRequests.id))
    .where(eq(shotRequests.importId, importId))
    .limit(1);
  return rows.length > 0;
};

export type SetImportOutputAspectRatioResult =
  | { ok: true; ratio: OutputAspectRatio; locked: false }
  | { ok: false; reason: "locked" | "invalid" | "missing"; ratio: OutputAspectRatio | null };

/**
 * Persist campaign format when unlocked. Server-side lock is authoritative.
 */
export const setImportOutputAspectRatio = async (params: {
  importId: string;
  ratio: string;
}): Promise<SetImportOutputAspectRatioResult> => {
  if (!isOutputAspectRatio(params.ratio)) {
    return { ok: false, reason: "invalid", ratio: null };
  }

  const locked = await isImportOutputFormatLocked(params.importId);
  if (locked) {
    const current = await getImportOutputAspectRatio(params.importId);
    return { ok: false, reason: "locked", ratio: current };
  }

  const db = getDb();
  const updated = await db
    .update(imports)
    .set({ outputAspectRatio: params.ratio })
    .where(eq(imports.id, params.importId))
    .returning({ id: imports.id, outputAspectRatio: imports.outputAspectRatio });

  if (updated.length === 0) {
    return { ok: false, reason: "missing", ratio: null };
  }

  return {
    ok: true,
    ratio: parseOutputAspectRatio(updated[0]?.outputAspectRatio),
    locked: false,
  };
};

export const resolveAspectRatioForShotRequest = async (
  shotRequestId: string,
): Promise<OutputAspectRatio> => {
  const db = getDb();
  const rows = await db
    .select({
      importId: shotRequests.importId,
      outputAspectRatio: imports.outputAspectRatio,
    })
    .from(shotRequests)
    .leftJoin(imports, eq(shotRequests.importId, imports.id))
    .where(eq(shotRequests.id, shotRequestId))
    .limit(1);

  if (!rows[0]?.importId) {
    return DEFAULT_OUTPUT_ASPECT_RATIO;
  }
  return parseOutputAspectRatio(rows[0].outputAspectRatio);
};

/** Count attempts for an import — used by tests and lock messaging. */
export const countGenerationAttemptsForImport = async (
  importId: string,
): Promise<number> => {
  const db = getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(generationAttempts)
    .innerJoin(shotRequests, eq(generationAttempts.shotRequestId, shotRequests.id))
    .where(and(eq(shotRequests.importId, importId)));
  return Number(rows[0]?.count ?? 0);
};

/** Attach lock state for Slack/Telegram preview rendering. */
export const withImportOutputFormatLock = async (
  summary: RequestPlanSummary,
): Promise<RequestPlanSummary> => ({
  ...summary,
  outputAspectRatioLocked: await isImportOutputFormatLocked(summary.importId),
});
