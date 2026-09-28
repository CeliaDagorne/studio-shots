CREATE TABLE "imports" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"total_catalog_rows" integer NOT NULL,
	"rows_with_shot_idea" integer NOT NULL,
	"new_requests" integer NOT NULL,
	"changed_requests" integer NOT NULL,
	"unchanged_existing_requests" integer NOT NULL,
	"planned_generations" integer NOT NULL,
	"additional_estimated_cost_micros_usd" integer NOT NULL,
	"warnings" jsonb NOT NULL,
	"priority_request_sku" text,
	"telegram_chat_id" bigint NOT NULL,
	"telegram_preview_message_id" integer,
	"confirmation_action" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"sku" text PRIMARY KEY NOT NULL,
	"product_name" text NOT NULL,
	"category" text NOT NULL,
	"color_or_finish" text NOT NULL,
	"material" text NOT NULL,
	"price_cents" integer NOT NULL,
	"photo_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shot_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"product_sku" text NOT NULL,
	"import_id" text,
	"supersedes_request_id" text,
	"shot_idea" text NOT NULL,
	"notes_snapshot" text,
	"request_hash" text NOT NULL,
	"workflow_status" text NOT NULL,
	"approved_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shot_requests" ADD CONSTRAINT "shot_requests_product_sku_products_sku_fk" FOREIGN KEY ("product_sku") REFERENCES "public"."products"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_requests" ADD CONSTRAINT "shot_requests_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imports_preview_message_idx" ON "imports" USING btree ("telegram_chat_id","telegram_preview_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shot_requests_sku_hash_idx" ON "shot_requests" USING btree ("product_sku","request_hash");