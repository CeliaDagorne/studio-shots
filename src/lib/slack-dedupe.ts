const seen = new Map<string, number>();

/** Drop remembered event ids older than this (ms). */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

const prune = (now: number, ttlMs: number) => {
  for (const [eventId, seenAt] of seen) {
    if (now - seenAt > ttlMs) {
      seen.delete(eventId);
    }
  }
};

/**
 * Claim a Slack event_id for processing. Returns false if this id was already seen.
 * In-memory only (per instance) — enough for foundation + tests; durable dedupe can follow later.
 */
export const claimSlackEventId = (
  eventId: string,
  options?: { nowMs?: number; ttlMs?: number },
): boolean => {
  const now = options?.nowMs ?? Date.now();
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  prune(now, ttlMs);

  if (seen.has(eventId)) {
    return false;
  }

  seen.set(eventId, now);
  return true;
};

/** Test helper: clear the in-memory dedupe set. */
export const resetSlackEventDedupeForTests = () => {
  seen.clear();
};
