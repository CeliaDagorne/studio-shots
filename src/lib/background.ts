import { waitUntil } from "@vercel/functions";
import { after } from "next/server";

/**
 * Schedule work to continue after the HTTP response is sent.
 *
 * - On Vercel: `waitUntil` keeps the isolate alive until the promise settles.
 * - In local `next dev`: `after()` (Next.js) + the open promise keep the work running.
 * - Outside a request context (unit tests): falls back to awaiting nothing; callers
 *   that need determinism should invoke the work directly instead.
 *
 * Never log secrets from the task — only safe error messages.
 */
export const scheduleBackground = (
  work: Promise<unknown>,
  label: string,
): void => {
  const tracked = work.catch((error) => {
    console.error(
      label,
      error instanceof Error ? error.message : "background work failed",
    );
  });

  try {
    after(() => tracked);
  } catch {
    // `after()` throws when called outside a Next.js request context.
  }

  waitUntil(tracked);
};
