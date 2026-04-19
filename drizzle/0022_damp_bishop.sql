CREATE TABLE "onchain_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer DEFAULT 84532 NOT NULL,
	"market_ref" text DEFAULT 'collateral' NOT NULL,
	"wallet_address" text NOT NULL,
	"user_id" text,
	"model_key" text,
	"collateral_display" real DEFAULT 0 NOT NULL,
	"yes_shares" real DEFAULT 0 NOT NULL,
	"no_shares" real DEFAULT 0 NOT NULL,
	"last_indexed_block" text DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "onchain_balances_collateral_display_check" CHECK ("onchain_balances"."collateral_display" >= 0),
	CONSTRAINT "onchain_balances_yes_shares_check" CHECK ("onchain_balances"."yes_shares" >= 0),
	CONSTRAINT "onchain_balances_no_shares_check" CHECK ("onchain_balances"."no_shares" >= 0)
);
--> statement-breakpoint
CREATE TABLE "onchain_events" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer DEFAULT 84532 NOT NULL,
	"contract_address" text NOT NULL,
	"tx_hash" text NOT NULL,
	"block_hash" text,
	"block_number" text NOT NULL,
	"log_index" integer NOT NULL,
	"event_name" text NOT NULL,
	"market_ref" text,
	"wallet_address" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "onchain_events_chain_id_check" CHECK ("onchain_events"."chain_id" > 0),
	CONSTRAINT "onchain_events_log_index_check" CHECK ("onchain_events"."log_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "onchain_faucet_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"wallet_address" text NOT NULL,
	"chain_id" integer DEFAULT 84532 NOT NULL,
	"amount_atomic" text NOT NULL,
	"amount_display" real NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"tx_hash" text,
	"error_message" text,
	"requested_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "onchain_faucet_claims_amount_display_check" CHECK ("onchain_faucet_claims"."amount_display" > 0),
	CONSTRAINT "onchain_faucet_claims_status_check" CHECK ("onchain_faucet_claims"."status" IN ('requested', 'submitted', 'confirmed', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "onchain_indexer_cursors" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer DEFAULT 84532 NOT NULL,
	"contract_address" text NOT NULL,
	"last_synced_block" text DEFAULT '0' NOT NULL,
	"latest_seen_block" text DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "onchain_indexer_cursors_chain_id_check" CHECK ("onchain_indexer_cursors"."chain_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "onchain_markets" (
	"id" text PRIMARY KEY NOT NULL,
	"trial_question_id" text,
	"market_slug" text NOT NULL,
	"chain_id" integer DEFAULT 84532 NOT NULL,
	"manager_address" text NOT NULL,
	"onchain_market_id" text,
	"title" text NOT NULL,
	"metadata_uri" text,
	"collateral_token_address" text,
	"execution_mode" text DEFAULT 'onchain_lmsr' NOT NULL,
	"position_model" text DEFAULT 'onchain_app_restricted' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"close_time" timestamp with time zone,
	"deploy_tx_hash" text,
	"resolve_tx_hash" text,
	"resolved_outcome" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "onchain_markets_chain_id_check" CHECK ("onchain_markets"."chain_id" > 0),
	CONSTRAINT "onchain_markets_execution_mode_check" CHECK ("onchain_markets"."execution_mode" = 'onchain_lmsr'),
	CONSTRAINT "onchain_markets_position_model_check" CHECK ("onchain_markets"."position_model" = 'onchain_app_restricted'),
	CONSTRAINT "onchain_markets_status_check" CHECK ("onchain_markets"."status" IN ('draft', 'deployed', 'closed', 'resolved', 'archived')),
	CONSTRAINT "onchain_markets_resolved_outcome_check" CHECK ("onchain_markets"."resolved_outcome" IS NULL OR "onchain_markets"."resolved_outcome" IN ('YES', 'NO'))
);
--> statement-breakpoint
CREATE TABLE "onchain_model_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"model_key" text NOT NULL,
	"display_name" text NOT NULL,
	"chain_id" integer DEFAULT 84532 NOT NULL,
	"wallet_address" text,
	"funding_status" text DEFAULT 'pending' NOT NULL,
	"bankroll_display" real DEFAULT 0 NOT NULL,
	"funded_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "onchain_model_wallets_chain_id_check" CHECK ("onchain_model_wallets"."chain_id" > 0),
	CONSTRAINT "onchain_model_wallets_funding_status_check" CHECK ("onchain_model_wallets"."funding_status" IN ('pending', 'funded', 'error')),
	CONSTRAINT "onchain_model_wallets_bankroll_display_check" CHECK ("onchain_model_wallets"."bankroll_display" >= 0)
);
--> statement-breakpoint
CREATE TABLE "onchain_user_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"privy_user_id" text,
	"chain_id" integer DEFAULT 84532 NOT NULL,
	"wallet_address" text,
	"provisioning_status" text DEFAULT 'pending' NOT NULL,
	"first_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "onchain_user_wallets_chain_id_check" CHECK ("onchain_user_wallets"."chain_id" > 0),
	CONSTRAINT "onchain_user_wallets_provisioning_status_check" CHECK ("onchain_user_wallets"."provisioning_status" IN ('pending', 'provisioning', 'ready', 'error'))
);
--> statement-breakpoint
ALTER TABLE "onchain_balances" ADD CONSTRAINT "onchain_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onchain_faucet_claims" ADD CONSTRAINT "onchain_faucet_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onchain_markets" ADD CONSTRAINT "onchain_markets_trial_question_id_trial_questions_id_fk" FOREIGN KEY ("trial_question_id") REFERENCES "public"."trial_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onchain_user_wallets" ADD CONSTRAINT "onchain_user_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_balances_wallet_market_idx" ON "onchain_balances" USING btree ("chain_id","wallet_address","market_ref");--> statement-breakpoint
CREATE INDEX "onchain_balances_wallet_idx" ON "onchain_balances" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "onchain_balances_user_idx" ON "onchain_balances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "onchain_balances_model_key_idx" ON "onchain_balances" USING btree ("model_key");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_events_tx_log_idx" ON "onchain_events" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "onchain_events_contract_block_idx" ON "onchain_events" USING btree ("contract_address","block_number");--> statement-breakpoint
CREATE INDEX "onchain_events_event_name_idx" ON "onchain_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "onchain_faucet_claims_wallet_requested_at_idx" ON "onchain_faucet_claims" USING btree ("wallet_address","requested_at");--> statement-breakpoint
CREATE INDEX "onchain_faucet_claims_tx_hash_idx" ON "onchain_faucet_claims" USING btree ("tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_indexer_cursors_contract_idx" ON "onchain_indexer_cursors" USING btree ("chain_id","contract_address");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_markets_market_slug_idx" ON "onchain_markets" USING btree ("market_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_markets_chain_market_idx" ON "onchain_markets" USING btree ("chain_id","manager_address","onchain_market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_model_wallets_model_key_idx" ON "onchain_model_wallets" USING btree ("model_key");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_model_wallets_wallet_address_idx" ON "onchain_model_wallets" USING btree ("wallet_address");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_user_wallets_user_id_idx" ON "onchain_user_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_user_wallets_wallet_address_idx" ON "onchain_user_wallets" USING btree ("wallet_address");