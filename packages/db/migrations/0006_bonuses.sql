CREATE TYPE "public"."bonus_source" AS ENUM('wheel', 'promo', 'level', 'leaderboard', 'achievement', 'admin');--> statement-breakpoint
CREATE TYPE "public"."entitlement_status" AS ENUM('active', 'used', 'expired');--> statement-breakpoint
CREATE TYPE "public"."entitlement_type" AS ENUM('free_case', 'wheel_spin', 'deposit_bonus');--> statement-breakpoint
CREATE TYPE "public"."leaderboard_period" AS ENUM('day', 'week');--> statement-breakpoint
CREATE TYPE "public"."leaderboard_period_status" AS ENUM('open', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."promo_type" AS ENUM('balance', 'deposit_bonus', 'free_case', 'wheel_spin', 'item');--> statement-breakpoint
CREATE TYPE "public"."wheel_prize_type" AS ENUM('balance', 'item', 'free_case', 'deposit_bonus', 'extra_spin');--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb NOT NULL,
	"icon" text NOT NULL,
	"condition" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "achievements_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "daily_bonus_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"streak" integer NOT NULL,
	"amount" bigint NOT NULL,
	"ledger_entry_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_payouts" (
	"period_id" uuid NOT NULL,
	"place" smallint NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"ledger_entry_id" bigint,
	CONSTRAINT "leaderboard_payouts_period_id_place_pk" PRIMARY KEY("period_id","place")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"leaderboard_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "leaderboard_period_status" DEFAULT 'open' NOT NULL,
	"standings" jsonb,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leaderboards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" smallint NOT NULL,
	"period" "leaderboard_period" NOT NULL,
	"metric" text DEFAULT 'drop_value' NOT NULL,
	"prizes" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "level_rewards_granted" (
	"user_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "level_rewards_granted_user_id_level_pk" PRIMARY KEY("user_id","level")
);
--> statement-breakpoint
CREATE TABLE "levels" (
	"level" integer PRIMARY KEY NOT NULL,
	"xp_required" bigint NOT NULL,
	"reward" jsonb
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"contacts" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_activations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"promo_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"result_ref_type" text,
	"result_ref_id" text,
	"ip" "inet",
	"device_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"type" "promo_type" NOT NULL,
	"amount" bigint,
	"percent" numeric(6, 4),
	"max_amount" bigint,
	"case_id" uuid,
	"item_id" uuid,
	"game_id" smallint,
	"total_limit" integer,
	"per_user_limit" integer DEFAULT 1 NOT NULL,
	"activations_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"min_deposit_gems" bigint,
	"min_deposit_period_days" integer,
	"new_users_max_age_hours" integer,
	"partner_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_limit" CHECK ("promo_codes"."total_limit" IS NULL OR "promo_codes"."activations_count" <= "promo_codes"."total_limit")
);
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referral_id" uuid NOT NULL,
	"deposit_id" uuid NOT NULL,
	"deposit_gems" bigint NOT NULL,
	"percent" numeric(6, 4) NOT NULL,
	"amount" bigint NOT NULL,
	"ledger_entry_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"achievement_id" uuid NOT NULL,
	"progress" bigint DEFAULT 0 NOT NULL,
	"unlocked_at" timestamp with time zone,
	CONSTRAINT "user_achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
CREATE TABLE "user_entitlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "entitlement_type" NOT NULL,
	"case_id" uuid,
	"percent" numeric(6, 4),
	"max_amount" bigint,
	"source_type" "bonus_source" NOT NULL,
	"source_id" text,
	"status" "entitlement_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"used_ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wheel_prizes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" smallint NOT NULL,
	"type" "wheel_prize_type" NOT NULL,
	"amount" bigint,
	"item_id" uuid,
	"case_id" uuid,
	"percent" numeric(6, 4),
	"max_amount" bigint,
	"weight" integer NOT NULL,
	"label" jsonb NOT NULL,
	"color" text DEFAULT '#24242E' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "wheel_prizes_weight_positive" CHECK ("wheel_prizes"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "wheel_spins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" smallint NOT NULL,
	"prize_id" uuid NOT NULL,
	"prizes_snapshot" jsonb NOT NULL,
	"prize_index" smallint NOT NULL,
	"is_extra" boolean DEFAULT false NOT NULL,
	"fair_seed_id" uuid NOT NULL,
	"nonce" integer NOT NULL,
	"roll" double precision NOT NULL,
	"ticket" integer NOT NULL,
	"result_ref_type" text,
	"result_ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "xp_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "entitlement_bonus_gems" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_bonus_claims" ADD CONSTRAINT "daily_bonus_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_payouts" ADD CONSTRAINT "leaderboard_payouts_period_id_leaderboard_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."leaderboard_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_payouts" ADD CONSTRAINT "leaderboard_payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_periods" ADD CONSTRAINT "leaderboard_periods_leaderboard_id_leaderboards_id_fk" FOREIGN KEY ("leaderboard_id") REFERENCES "public"."leaderboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboards" ADD CONSTRAINT "leaderboards_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_rewards_granted" ADD CONSTRAINT "level_rewards_granted_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_activations" ADD CONSTRAINT "promo_activations_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_activations" ADD CONSTRAINT "promo_activations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referral_id_users_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_prizes" ADD CONSTRAINT "wheel_prizes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_prizes" ADD CONSTRAINT "wheel_prizes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_prizes" ADD CONSTRAINT "wheel_prizes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_spins" ADD CONSTRAINT "wheel_spins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_spins" ADD CONSTRAINT "wheel_spins_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_spins" ADD CONSTRAINT "wheel_spins_prize_id_wheel_prizes_id_fk" FOREIGN KEY ("prize_id") REFERENCES "public"."wheel_prizes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_spins" ADD CONSTRAINT "wheel_spins_fair_seed_id_fair_seeds_id_fk" FOREIGN KEY ("fair_seed_id") REFERENCES "public"."fair_seeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_bonus_claims_user_day_uq" ON "daily_bonus_claims" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_periods_uq" ON "leaderboard_periods" USING btree ("leaderboard_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboards_game_period_uq" ON "leaderboards" USING btree ("game_id","period");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "promo_activations_promo_idx" ON "promo_activations" USING btree ("promo_id","created_at");--> statement-breakpoint
CREATE INDEX "promo_activations_user_idx" ON "promo_activations" USING btree ("user_id","promo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code_uq" ON "promo_codes" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "promo_codes_partner_idx" ON "promo_codes" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_rewards_deposit_uq" ON "referral_rewards" USING btree ("deposit_id");--> statement-breakpoint
CREATE INDEX "referral_rewards_referrer_idx" ON "referral_rewards" USING btree ("referrer_id","created_at");--> statement-breakpoint
CREATE INDEX "user_entitlements_user_idx" ON "user_entitlements" USING btree ("user_id","status","type");--> statement-breakpoint
CREATE INDEX "wheel_prizes_game_idx" ON "wheel_prizes" USING btree ("game_id","sort_order");--> statement-breakpoint
CREATE INDEX "wheel_spins_user_idx" ON "wheel_spins" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_events_source_uq" ON "xp_events" USING btree ("user_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "user_items_game_acquired_idx" ON "user_items" USING btree ("game_id","acquired_at");