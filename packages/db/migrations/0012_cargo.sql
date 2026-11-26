CREATE TYPE "public"."cargo_round_status" AS ENUM('open', 'landed', 'expired', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."item_source" ADD VALUE 'cargo';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'cargo_entry';--> statement-breakpoint
ALTER TYPE "public"."ledger_type" ADD VALUE 'cargo_refund';--> statement-breakpoint
CREATE TABLE "cargo_purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seat_from" integer NOT NULL,
	"seat_to" integer NOT NULL,
	"count" integer NOT NULL,
	"paid" bigint NOT NULL,
	"client_seed" text NOT NULL,
	"ledger_entry_id" bigint,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cargo_purchases_range" CHECK ("cargo_purchases"."seat_from" >= 1 AND "cargo_purchases"."seat_to" >= "cargo_purchases"."seat_from" AND "cargo_purchases"."count" = "cargo_purchases"."seat_to" - "cargo_purchases"."seat_from" + 1),
	CONSTRAINT "cargo_purchases_paid" CHECK ("cargo_purchases"."paid" >= 0),
	CONSTRAINT "cargo_purchases_ledger" CHECK (("cargo_purchases"."paid" = 0) = ("cargo_purchases"."ledger_entry_id" IS NULL)),
	CONSTRAINT "cargo_purchases_seed" CHECK ("cargo_purchases"."client_seed" ~ '^[A-Za-z0-9_-]{8,64}$')
);
--> statement-breakpoint
CREATE TABLE "cargo_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"game_id" smallint NOT NULL,
	"number" integer NOT NULL,
	"status" "cargo_round_status" DEFAULT 'open' NOT NULL,
	"prize_item_id" uuid NOT NULL,
	"prize_value" bigint NOT NULL,
	"seats_total" integer NOT NULL,
	"seats_sold" integer DEFAULT 0 NOT NULL,
	"seat_price" bigint NOT NULL,
	"per_user_limit" integer,
	"min_level" integer,
	"deposit_within_days" integer,
	"min_seats_to_land" integer,
	"server_seed_enc" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text,
	"winning_seat" integer,
	"void_seat" integer,
	"winner_id" uuid,
	"winner_purchase_id" uuid,
	"user_item_id" uuid,
	"land_reason" text,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"land_attempts" integer DEFAULT 0 NOT NULL,
	"last_land_error_at" timestamp with time zone,
	"last_land_error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "cargo_rounds_seats" CHECK ("cargo_rounds"."seats_sold" >= 0 AND "cargo_rounds"."seats_sold" <= "cargo_rounds"."seats_total"),
	CONSTRAINT "cargo_rounds_price" CHECK ("cargo_rounds"."seat_price" >= 0),
	CONSTRAINT "cargo_rounds_min_seats" CHECK ("cargo_rounds"."min_seats_to_land" IS NULL OR "cargo_rounds"."min_seats_to_land" <= "cargo_rounds"."seats_total")
);
--> statement-breakpoint
CREATE TABLE "cargo_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" smallint NOT NULL,
	"slug" text NOT NULL,
	"name" jsonb NOT NULL,
	"image_url" text NOT NULL,
	"prize_item_id" uuid NOT NULL,
	"seats_total" integer NOT NULL,
	"seat_price" bigint NOT NULL,
	"per_user_limit" integer,
	"duration_minutes" integer NOT NULL,
	"min_level" integer,
	"deposit_within_days" integer,
	"min_seats_to_land" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cargo_templates_seats" CHECK ("cargo_templates"."seats_total" >= 2 AND "cargo_templates"."seats_total" <= 10000),
	CONSTRAINT "cargo_templates_price" CHECK ("cargo_templates"."seat_price" >= 0),
	CONSTRAINT "cargo_templates_limit" CHECK ("cargo_templates"."per_user_limit" IS NULL OR "cargo_templates"."per_user_limit" >= 1),
	CONSTRAINT "cargo_templates_free_limit" CHECK ("cargo_templates"."seat_price" > 0 OR coalesce("cargo_templates"."per_user_limit", 0) = 1),
	CONSTRAINT "cargo_templates_duration" CHECK ("cargo_templates"."duration_minutes" >= 1),
	CONSTRAINT "cargo_templates_min_seats" CHECK ("cargo_templates"."min_seats_to_land" IS NULL OR ("cargo_templates"."min_seats_to_land" >= 1 AND "cargo_templates"."min_seats_to_land" <= "cargo_templates"."seats_total")),
	CONSTRAINT "cargo_templates_archived" CHECK ("cargo_templates"."archived_at" IS NULL OR NOT "cargo_templates"."is_active")
);
--> statement-breakpoint
ALTER TABLE "cargo_purchases" ADD CONSTRAINT "cargo_purchases_round_id_cargo_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."cargo_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_purchases" ADD CONSTRAINT "cargo_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_purchases" ADD CONSTRAINT "cargo_purchases_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_rounds" ADD CONSTRAINT "cargo_rounds_template_id_cargo_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."cargo_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_rounds" ADD CONSTRAINT "cargo_rounds_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_rounds" ADD CONSTRAINT "cargo_rounds_prize_item_id_items_id_fk" FOREIGN KEY ("prize_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_rounds" ADD CONSTRAINT "cargo_rounds_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_rounds" ADD CONSTRAINT "cargo_rounds_user_item_id_user_items_id_fk" FOREIGN KEY ("user_item_id") REFERENCES "public"."user_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_rounds" ADD CONSTRAINT "cargo_rounds_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_templates" ADD CONSTRAINT "cargo_templates_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_templates" ADD CONSTRAINT "cargo_templates_prize_item_id_items_id_fk" FOREIGN KEY ("prize_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cargo_purchases_round_seat_uq" ON "cargo_purchases" USING btree ("round_id","seat_from");--> statement-breakpoint
CREATE UNIQUE INDEX "cargo_purchases_ledger_uq" ON "cargo_purchases" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "cargo_purchases_round_user_idx" ON "cargo_purchases" USING btree ("round_id","user_id");--> statement-breakpoint
CREATE INDEX "cargo_purchases_user_idx" ON "cargo_purchases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cargo_rounds_template_number_uq" ON "cargo_rounds" USING btree ("template_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "cargo_rounds_one_open_uq" ON "cargo_rounds" USING btree ("template_id") WHERE "cargo_rounds"."status" = 'open';--> statement-breakpoint
CREATE INDEX "cargo_rounds_due_idx" ON "cargo_rounds" USING btree ("ends_at") WHERE "cargo_rounds"."status" = 'open';--> statement-breakpoint
CREATE INDEX "cargo_rounds_game_status_idx" ON "cargo_rounds" USING btree ("game_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "cargo_templates_game_slug_uq" ON "cargo_templates" USING btree ("game_id","slug");--> statement-breakpoint
CREATE INDEX "cargo_templates_game_sort_idx" ON "cargo_templates" USING btree ("game_id","sort_order");