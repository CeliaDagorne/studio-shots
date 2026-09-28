ALTER TABLE "imports" ADD COLUMN "existing_pending_requests" integer;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "requests_ready_to_generate" integer;--> statement-breakpoint
UPDATE "imports"
SET
  "existing_pending_requests" = COALESCE("unchanged_existing_requests", 0),
  "requests_ready_to_generate" = COALESCE("new_requests", 0) + COALESCE("changed_requests", 0) + COALESCE("unchanged_existing_requests", 0)
WHERE "existing_pending_requests" IS NULL
   OR "requests_ready_to_generate" IS NULL;--> statement-breakpoint
ALTER TABLE "imports" ALTER COLUMN "existing_pending_requests" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ALTER COLUMN "requests_ready_to_generate" SET NOT NULL;
