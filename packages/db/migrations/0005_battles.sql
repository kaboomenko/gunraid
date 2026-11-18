CREATE TYPE "public"."battle_format" AS ENUM('1v1', '1v1v1', '1v1v1v1', '2v2');--> statement-breakpoint
CREATE TYPE "public"."battle_mode" AS ENUM('classic', 'crazy');--> statement-breakpoint
CREATE TYPE "public"."battle_status" AS ENUM('waiting', 'in_progress', 'finished', 'cancelled');--> statement-breakpoint
CREATE TABLE "battle_cases" (
	"battle_id" uuid NOT NULL,
	"round_index" smallint NOT NULL,
	"case_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	CONSTRAINT "battle_cases_battle_id_round_index_pk" PRIMARY KEY("battle_id","round_index")
);
--> statement-breakpoint
CREATE TABLE "battle_drops" (
	"battle_id" uuid NOT NULL,
	"round_index" smallint NOT NULL,
	"slot" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	"item_value" bigint NOT NULL,
	"roll" double precision NOT NULL,
	"ticket" integer NOT NULL,
	"recipient_slot" smallint,
	"user_item_id" uuid,
	CONSTRAINT "battle_drops_battle_id_round_index_slot_pk" PRIMARY KEY("battle_id","round_index","slot")
);
--> statement-breakpoint
CREATE TABLE "battle_participants" (
	"battle_id" uuid NOT NULL,
	"slot" smallint NOT NULL,
	"team" smallint,
	"user_id" uuid,
	"bot_id" smallint,
	"client_seed" text NOT NULL,
	"paid_amount" bigint DEFAULT 0 NOT NULL,
	"total_value" bigint DEFAULT 0 NOT NULL,
	"is_winner" boolean,
	"payout_value" bigint DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_participants_battle_id_slot_pk" PRIMARY KEY("battle_id","slot"),
	CONSTRAINT "battle_participants_user_or_bot" CHECK (("battle_participants"."user_id" IS NULL) <> ("battle_participants"."bot_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "battles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" smallint NOT NULL,
	"creator_id" uuid NOT NULL,
	"format" "battle_format" NOT NULL,
	"mode" "battle_mode" NOT NULL,
	"status" "battle_status" DEFAULT 'waiting' NOT NULL,
	"max_players" smallint NOT NULL,
	"entry_price" bigint NOT NULL,
	"rounds_count" smallint NOT NULL,
	"round_duration_ms" integer NOT NULL,
	"server_seed_enc" text NOT NULL,
	"server_seed_hash" text NOT NULL,
	"client_seed" text,
	"tiebreak_roll" double precision,
	"winner_team" smallint,
	"total_value" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "battles_entry_positive" CHECK ("battles"."entry_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "bot_profiles" (
	"id" smallint PRIMARY KEY NOT NULL,
	"nickname" text NOT NULL,
	"avatar_url" text
);
--> statement-breakpoint
ALTER TABLE "battle_cases" ADD CONSTRAINT "battle_cases_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_cases" ADD CONSTRAINT "battle_cases_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_cases" ADD CONSTRAINT "battle_cases_revision_id_case_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."case_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_drops" ADD CONSTRAINT "battle_drops_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_drops" ADD CONSTRAINT "battle_drops_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_drops" ADD CONSTRAINT "battle_drops_user_item_id_user_items_id_fk" FOREIGN KEY ("user_item_id") REFERENCES "public"."user_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_bot_id_bot_profiles_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bot_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "battle_participants_user_uq" ON "battle_participants" USING btree ("battle_id","user_id") WHERE "battle_participants"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "battle_participants_user_idx" ON "battle_participants" USING btree ("user_id","joined_at");--> statement-breakpoint
CREATE INDEX "battles_game_status_idx" ON "battles" USING btree ("game_id","status","created_at");--> statement-breakpoint
CREATE INDEX "battles_creator_idx" ON "battles" USING btree ("creator_id","created_at");