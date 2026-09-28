ALTER TABLE "imports" ADD COLUMN "telegram_update_id" bigint;--> statement-breakpoint
UPDATE "imports"
SET "telegram_update_id" = -(
  SELECT count(*)
  FROM "imports" AS older
  WHERE older."created_at" <= "imports"."created_at"
    AND older."id" <= "imports"."id"
)
WHERE "telegram_update_id" IS NULL;--> statement-breakpoint
ALTER TABLE "imports" ALTER COLUMN "telegram_update_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "imports_telegram_update_id_idx" ON "imports" USING btree ("telegram_update_id");
