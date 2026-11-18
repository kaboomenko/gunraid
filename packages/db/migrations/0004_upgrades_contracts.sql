CREATE TYPE "public"."upgrade_stake_type" AS ENUM('items', 'balance');--> statement-breakpoint
CREATE TABLE "contract_items" (
	"contract_id" uuid NOT NULL,
	"user_item_id" uuid NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "contract_items_contract_id_user_item_id_pk" PRIMARY KEY("contract_id","user_item_id")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" smallint NOT NULL,
	"input_value" bigint NOT NULL,
	"k_min" numeric(10, 4) NOT NULL,
	"k_max" numeric(10, 4) NOT NULL,
	"gamma" double precision NOT NULL,
	"commission" numeric(6, 4) NOT NULL,
	"fair_seed_id" uuid NOT NULL,
	"nonce" integer NOT NULL,
	"roll" double precision NOT NULL,
	"multiplier" double precision NOT NULL,
	"target_value" bigint NOT NULL,
	"result_item_id" uuid NOT NULL,
	"result_value" bigint NOT NULL,
	"result_user_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upgrade_stake_items" (
	"upgrade_id" uuid NOT NULL,
	"user_item_id" uuid NOT NULL,
	"value" bigint NOT NULL,
	CONSTRAINT "upgrade_stake_items_upgrade_id_user_item_id_pk" PRIMARY KEY("upgrade_id","user_item_id")
);
--> statement-breakpoint
CREATE TABLE "upgrades" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" smallint NOT NULL,
	"stake_type" "upgrade_stake_type" NOT NULL,
	"stake_amount" bigint DEFAULT 0 NOT NULL,
	"stake_value" bigint NOT NULL,
	"target_item_id" uuid NOT NULL,
	"target_price" bigint NOT NULL,
	"chance" integer NOT NULL,
	"commission" numeric(6, 4) NOT NULL,
	"max_chance" numeric(6, 4) NOT NULL,
	"fair_seed_id" uuid NOT NULL,
	"nonce" integer NOT NULL,
	"roll" integer NOT NULL,
	"is_win" boolean NOT NULL,
	"result_user_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_items" ADD CONSTRAINT "contract_items_user_item_id_user_items_id_fk" FOREIGN KEY ("user_item_id") REFERENCES "public"."user_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_fair_seed_id_fair_seeds_id_fk" FOREIGN KEY ("fair_seed_id") REFERENCES "public"."fair_seeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_result_item_id_items_id_fk" FOREIGN KEY ("result_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_result_user_item_id_user_items_id_fk" FOREIGN KEY ("result_user_item_id") REFERENCES "public"."user_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_stake_items" ADD CONSTRAINT "upgrade_stake_items_upgrade_id_upgrades_id_fk" FOREIGN KEY ("upgrade_id") REFERENCES "public"."upgrades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrade_stake_items" ADD CONSTRAINT "upgrade_stake_items_user_item_id_user_items_id_fk" FOREIGN KEY ("user_item_id") REFERENCES "public"."user_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrades" ADD CONSTRAINT "upgrades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrades" ADD CONSTRAINT "upgrades_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrades" ADD CONSTRAINT "upgrades_target_item_id_items_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrades" ADD CONSTRAINT "upgrades_fair_seed_id_fair_seeds_id_fk" FOREIGN KEY ("fair_seed_id") REFERENCES "public"."fair_seeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upgrades" ADD CONSTRAINT "upgrades_result_user_item_id_user_items_id_fk" FOREIGN KEY ("result_user_item_id") REFERENCES "public"."user_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_user_idx" ON "contracts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "contracts_created_idx" ON "contracts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "upgrades_user_idx" ON "upgrades" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "upgrades_created_idx" ON "upgrades" USING btree ("created_at");