ALTER TABLE "imports" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "external_event_id" text;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "preview_message_id" text;--> statement-breakpoint
UPDATE "imports"
SET
  "platform" = 'telegram',
  "conversation_id" = "telegram_chat_id"::text,
  "external_event_id" = "telegram_update_id"::text,
  "preview_message_id" = "telegram_preview_message_id"::text
WHERE "platform" IS NULL;--> statement-breakpoint
ALTER TABLE "imports" ALTER COLUMN "platform" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ALTER COLUMN "conversation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ALTER COLUMN "external_event_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX "imports_preview_message_idx";--> statement-breakpoint
DROP INDEX "imports_telegram_update_id_idx";--> statement-breakpoint
ALTER TABLE "imports" DROP COLUMN "telegram_update_id";--> statement-breakpoint
ALTER TABLE "imports" DROP COLUMN "telegram_chat_id";--> statement-breakpoint
ALTER TABLE "imports" DROP COLUMN "telegram_preview_message_id";--> statement-breakpoint
CREATE UNIQUE INDEX "imports_platform_external_event_idx" ON "imports" USING btree ("platform","external_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_preview_message_idx" ON "imports" USING btree ("platform","conversation_id","preview_message_id");--> statement-breakpoint
ALTER TABLE "generation_candidates" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "generation_candidates" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "generation_candidates" ADD COLUMN "external_message_id" text;--> statement-breakpoint
UPDATE "generation_candidates"
SET
  "platform" = 'telegram',
  "conversation_id" = "telegram_chat_id"::text,
  "external_message_id" = "telegram_message_id"::text
WHERE "telegram_chat_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_candidates" DROP COLUMN "telegram_chat_id";--> statement-breakpoint
ALTER TABLE "generation_candidates" DROP COLUMN "telegram_message_id";
