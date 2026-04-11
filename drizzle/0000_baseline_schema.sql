CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"referrer" text,
	"user_agent" text,
	"session_hash" text,
	"element_id" text,
	"ip_address" text,
	"country" text,
	"city" text,
	"search_query" text,
	"result_count" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crash_events" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"digest" text,
	"error_name" text,
	"message" text NOT NULL,
	"stack" text,
	"component_stack" text,
	"url" text,
	"path" text,
	"source" text DEFAULT 'app-error' NOT NULL,
	"request_id" text,
	"error_code" text,
	"status_code" integer,
	"details" text,
	"user_id" text,
	"user_email" text,
	"user_agent" text,
	"ip_address" text,
	"country" text,
	"city" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_monitor_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"run_interval_hours" integer DEFAULT 6 NOT NULL,
	"hard_lookahead_days" integer DEFAULT 7 NOT NULL,
	"soft_lookahead_days" integer DEFAULT 14 NOT NULL,
	"overdue_recheck_hours" integer DEFAULT 24 NOT NULL,
	"max_events_per_run" integer DEFAULT 25 NOT NULL,
	"verifier_model_key" text DEFAULT 'gpt-5.4' NOT NULL,
	"min_candidate_confidence" real DEFAULT 0.8 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_monitor_configs_run_interval_hours_check" CHECK ("event_monitor_configs"."run_interval_hours" >= 1 AND "event_monitor_configs"."run_interval_hours" <= 168),
	CONSTRAINT "event_monitor_configs_hard_lookahead_days_check" CHECK ("event_monitor_configs"."hard_lookahead_days" >= 0 AND "event_monitor_configs"."hard_lookahead_days" <= 365),
	CONSTRAINT "event_monitor_configs_soft_lookahead_days_check" CHECK ("event_monitor_configs"."soft_lookahead_days" >= 0 AND "event_monitor_configs"."soft_lookahead_days" <= 365),
	CONSTRAINT "event_monitor_configs_overdue_recheck_hours_check" CHECK ("event_monitor_configs"."overdue_recheck_hours" >= 1 AND "event_monitor_configs"."overdue_recheck_hours" <= 720),
	CONSTRAINT "event_monitor_configs_max_events_per_run_check" CHECK ("event_monitor_configs"."max_events_per_run" >= 1 AND "event_monitor_configs"."max_events_per_run" <= 500),
	CONSTRAINT "event_monitor_configs_min_candidate_confidence_check" CHECK ("event_monitor_configs"."min_candidate_confidence" >= 0 AND "event_monitor_configs"."min_candidate_confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "event_monitor_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger_source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"events_scanned" integer DEFAULT 0 NOT NULL,
	"candidates_created" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_monitor_runs_trigger_source_check" CHECK ("event_monitor_runs"."trigger_source" IN ('cron', 'manual')),
	CONSTRAINT "event_monitor_runs_status_check" CHECK ("event_monitor_runs"."status" IN ('running', 'completed', 'failed')),
	CONSTRAINT "event_monitor_runs_events_scanned_check" CHECK ("event_monitor_runs"."events_scanned" >= 0),
	CONSTRAINT "event_monitor_runs_candidates_created_check" CHECK ("event_monitor_runs"."candidates_created" >= 0)
);
--> statement-breakpoint
CREATE TABLE "event_outcome_candidate_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"source_type" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"excerpt" text NOT NULL,
	"domain" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_outcome_candidate_evidence_source_type_check" CHECK ("event_outcome_candidate_evidence"."source_type" IN ('fda', 'sponsor', 'stored_source', 'web_search'))
);
--> statement-breakpoint
CREATE TABLE "event_outcome_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"proposed_outcome" text NOT NULL,
	"proposed_outcome_date" timestamp with time zone,
	"confidence" real NOT NULL,
	"summary" text NOT NULL,
	"verifier_model_key" text NOT NULL,
	"provider_response_id" text,
	"evidence_hash" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reviewed_by_user_id" text,
	"review_notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "event_outcome_candidates_proposed_outcome_check" CHECK ("event_outcome_candidates"."proposed_outcome" IN ('Approved', 'Rejected')),
	CONSTRAINT "event_outcome_candidates_confidence_check" CHECK ("event_outcome_candidates"."confidence" >= 0 AND "event_outcome_candidates"."confidence" <= 1),
	CONSTRAINT "event_outcome_candidates_status_check" CHECK ("event_outcome_candidates"."status" IN ('pending_review', 'accepted', 'rejected', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "fda_calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"symbols" text NOT NULL,
	"drug_name" text NOT NULL,
	"application_type" text NOT NULL,
	"decision_date" date NOT NULL,
	"event_description" text NOT NULL,
	"outcome" text DEFAULT 'Pending' NOT NULL,
	"outcome_date" timestamp with time zone,
	"decision_date_kind" text DEFAULT 'hard' NOT NULL,
	"cnpv_award_date" date,
	"drug_status" text,
	"therapeutic_area" text,
	"last_monitored_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"scraped_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fda_calendar_events_outcome_check" CHECK ("fda_calendar_events"."outcome" IN ('Pending', 'Approved', 'Rejected')),
	CONSTRAINT "fda_calendar_events_decision_date_kind_check" CHECK ("fda_calendar_events"."decision_date_kind" IN ('hard', 'soft'))
);
--> statement-breakpoint
CREATE TABLE "fda_event_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"analysis_type" text NOT NULL,
	"content" text NOT NULL,
	"model_key" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fda_event_analyses_type_check" CHECK ("fda_event_analyses"."analysis_type" IN ('meta_analysis'))
);
--> statement-breakpoint
CREATE TABLE "fda_event_contexts" (
	"event_id" text PRIMARY KEY NOT NULL,
	"rival_drugs" text,
	"market_potential" text,
	"other_approvals" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fda_event_external_ids" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"id_type" text NOT NULL,
	"id_value" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fda_event_external_ids_type_check" CHECK ("fda_event_external_ids"."id_type" IN ('external_key', 'nct', 'rtt_detail'))
);
--> statement-breakpoint
CREATE TABLE "fda_event_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"source_type" text NOT NULL,
	"label" text,
	"url" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fda_event_sources_type_check" CHECK ("fda_event_sources"."source_type" IN ('primary', 'news_link', 'reference'))
);
--> statement-breakpoint
CREATE TABLE "market_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"starting_cash" real DEFAULT 100000 NOT NULL,
	"cash_balance" real DEFAULT 100000 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_accounts_starting_cash_check" CHECK ("market_accounts"."starting_cash" >= 0),
	CONSTRAINT "market_accounts_cash_balance_check" CHECK ("market_accounts"."cash_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"market_id" text NOT NULL,
	"fda_event_id" text,
	"trial_question_id" text,
	"actor_id" text NOT NULL,
	"run_date" date NOT NULL,
	"action_source" text DEFAULT 'cycle' NOT NULL,
	"action" text NOT NULL,
	"usd_amount" real DEFAULT 0 NOT NULL,
	"shares_delta" real DEFAULT 0 NOT NULL,
	"price_before" real NOT NULL,
	"price_after" real NOT NULL,
	"explanation" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"error_code" text,
	"error_details" text,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_actions_action_source_check" CHECK ("market_actions"."action_source" IN ('cycle', 'human')),
	CONSTRAINT "market_actions_action_source_shape_check" CHECK ((
      ("market_actions"."action_source" = 'cycle' AND "market_actions"."run_id" IS NOT NULL)
      OR
      ("market_actions"."action_source" = 'human' AND "market_actions"."run_id" IS NULL)
    )),
	CONSTRAINT "market_actions_ownership_check" CHECK ((
      ("market_actions"."fda_event_id" IS NOT NULL AND "market_actions"."trial_question_id" IS NULL)
      OR
      ("market_actions"."fda_event_id" IS NULL AND "market_actions"."trial_question_id" IS NOT NULL)
    )),
	CONSTRAINT "market_actions_action_check" CHECK ("market_actions"."action" IN ('BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD')),
	CONSTRAINT "market_actions_status_check" CHECK ("market_actions"."status" IN ('ok', 'error', 'skipped')),
	CONSTRAINT "market_actions_usd_amount_check" CHECK ("market_actions"."usd_amount" >= 0),
	CONSTRAINT "market_actions_price_before_check" CHECK ("market_actions"."price_before" >= 0 AND "market_actions"."price_before" <= 1),
	CONSTRAINT "market_actions_price_after_check" CHECK ("market_actions"."price_after" >= 0 AND "market_actions"."price_after" <= 1),
	CONSTRAINT "market_actions_direction_check" CHECK ((
      ("market_actions"."action" IN ('BUY_YES', 'BUY_NO') AND "market_actions"."shares_delta" >= 0 AND "market_actions"."usd_amount" >= 0)
      OR
      ("market_actions"."action" IN ('SELL_YES', 'SELL_NO') AND "market_actions"."shares_delta" <= 0 AND "market_actions"."usd_amount" >= 0)
      OR
      ("market_actions"."action" = 'HOLD' AND "market_actions"."shares_delta" = 0 AND "market_actions"."usd_amount" = 0)
    ))
);
--> statement-breakpoint
CREATE TABLE "market_actors" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"model_key" text,
	"user_id" text,
	"display_name" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_actors_actor_type_check" CHECK ("market_actors"."actor_type" IN ('model', 'human')),
	CONSTRAINT "market_actors_shape_check" CHECK ((
      ("market_actors"."actor_type" = 'model' AND "market_actors"."model_key" IS NOT NULL AND "market_actors"."user_id" IS NULL)
      OR
      ("market_actors"."actor_type" = 'human' AND "market_actors"."user_id" IS NOT NULL AND "market_actors"."model_key" IS NULL)
    ))
);
--> statement-breakpoint
CREATE TABLE "market_daily_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"actor_id" text NOT NULL,
	"cash_balance" real NOT NULL,
	"positions_value" real NOT NULL,
	"total_equity" real NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_daily_snapshots_cash_balance_check" CHECK ("market_daily_snapshots"."cash_balance" >= 0),
	CONSTRAINT "market_daily_snapshots_positions_value_check" CHECK ("market_daily_snapshots"."positions_value" >= 0),
	CONSTRAINT "market_daily_snapshots_total_equity_check" CHECK ("market_daily_snapshots"."total_equity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"yes_shares" real DEFAULT 0 NOT NULL,
	"no_shares" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_positions_yes_shares_check" CHECK ("market_positions"."yes_shares" >= 0),
	CONSTRAINT "market_positions_no_shares_check" CHECK ("market_positions"."no_shares" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_price_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"price_yes" real NOT NULL,
	"q_yes" real NOT NULL,
	"q_no" real NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_price_snapshots_price_yes_check" CHECK ("market_price_snapshots"."price_yes" >= 0 AND "market_price_snapshots"."price_yes" <= 1)
);
--> statement-breakpoint
CREATE TABLE "market_run_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"log_type" text DEFAULT 'activity' NOT NULL,
	"message" text NOT NULL,
	"completed_actions" integer,
	"total_actions" integer,
	"ok_count" integer,
	"error_count" integer,
	"skipped_count" integer,
	"market_id" text,
	"fda_event_id" text,
	"trial_question_id" text,
	"actor_id" text,
	"activity_phase" text,
	"action" text,
	"action_status" text,
	"amount_usd" real,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_run_logs_log_type_check" CHECK ("market_run_logs"."log_type" IN ('system', 'activity', 'progress', 'error')),
	CONSTRAINT "market_run_logs_activity_phase_check" CHECK ("market_run_logs"."activity_phase" IS NULL OR "market_run_logs"."activity_phase" IN ('running', 'waiting')),
	CONSTRAINT "market_run_logs_action_status_check" CHECK ("market_run_logs"."action_status" IS NULL OR "market_run_logs"."action_status" IN ('ok', 'error', 'skipped')),
	CONSTRAINT "market_run_logs_completed_actions_check" CHECK ("market_run_logs"."completed_actions" IS NULL OR "market_run_logs"."completed_actions" >= 0),
	CONSTRAINT "market_run_logs_total_actions_check" CHECK ("market_run_logs"."total_actions" IS NULL OR "market_run_logs"."total_actions" >= 0),
	CONSTRAINT "market_run_logs_ok_count_check" CHECK ("market_run_logs"."ok_count" IS NULL OR "market_run_logs"."ok_count" >= 0),
	CONSTRAINT "market_run_logs_error_count_check" CHECK ("market_run_logs"."error_count" IS NULL OR "market_run_logs"."error_count" >= 0),
	CONSTRAINT "market_run_logs_skipped_count_check" CHECK ("market_run_logs"."skipped_count" IS NULL OR "market_run_logs"."skipped_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_date" date NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"open_markets" integer DEFAULT 0 NOT NULL,
	"total_actions" integer DEFAULT 0 NOT NULL,
	"processed_actions" integer DEFAULT 0 NOT NULL,
	"ok_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "market_runs_status_check" CHECK ("market_runs"."status" IN ('running', 'completed', 'failed')),
	CONSTRAINT "market_runs_open_markets_check" CHECK ("market_runs"."open_markets" >= 0),
	CONSTRAINT "market_runs_total_actions_check" CHECK ("market_runs"."total_actions" >= 0),
	CONSTRAINT "market_runs_processed_actions_check" CHECK ("market_runs"."processed_actions" >= 0 AND "market_runs"."processed_actions" <= "market_runs"."total_actions"),
	CONSTRAINT "market_runs_ok_count_check" CHECK ("market_runs"."ok_count" >= 0),
	CONSTRAINT "market_runs_error_count_check" CHECK ("market_runs"."error_count" >= 0),
	CONSTRAINT "market_runs_skipped_count_check" CHECK ("market_runs"."skipped_count" >= 0),
	CONSTRAINT "market_runs_count_sum_check" CHECK ("market_runs"."ok_count" + "market_runs"."error_count" + "market_runs"."skipped_count" <= "market_runs"."processed_actions")
);
--> statement-breakpoint
CREATE TABLE "market_runtime_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"max_position_per_side_shares" real DEFAULT 10000 NOT NULL,
	"opening_lmsr_b" real DEFAULT 100000 NOT NULL,
	"signup_user_limit" integer DEFAULT 56 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_runtime_configs_max_position_per_side_shares_check" CHECK ("market_runtime_configs"."max_position_per_side_shares" >= 0 AND "market_runtime_configs"."max_position_per_side_shares" <= 10000000),
	CONSTRAINT "market_runtime_configs_opening_lmsr_b_check" CHECK ("market_runtime_configs"."opening_lmsr_b" > 0 AND "market_runtime_configs"."opening_lmsr_b" <= 10000000),
	CONSTRAINT "market_runtime_configs_signup_user_limit_check" CHECK ("market_runtime_configs"."signup_user_limit" >= 0 AND "market_runtime_configs"."signup_user_limit" <= 10000000)
);
--> statement-breakpoint
CREATE TABLE "model_decision_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"run_date" date NOT NULL,
	"market_id" text NOT NULL,
	"fda_event_id" text,
	"trial_question_id" text,
	"actor_id" text NOT NULL,
	"run_source" text NOT NULL,
	"approval_probability" real NOT NULL,
	"yes_probability" real,
	"binary_call" text NOT NULL,
	"confidence" integer NOT NULL,
	"reasoning" text NOT NULL,
	"proposed_action_type" text NOT NULL,
	"proposed_amount_usd" real DEFAULT 0 NOT NULL,
	"proposed_explanation" text NOT NULL,
	"market_price_yes" real,
	"market_price_no" real,
	"cash_available" real,
	"yes_shares_held" real,
	"no_shares_held" real,
	"max_buy_usd" real,
	"max_sell_yes_usd" real,
	"max_sell_no_usd" real,
	"duration_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"reasoning_tokens" integer,
	"estimated_cost_usd" real,
	"cost_source" text,
	"cache_creation_input_tokens_5m" integer,
	"cache_creation_input_tokens_1h" integer,
	"cache_read_input_tokens" integer,
	"web_search_requests" integer,
	"inference_geo" text,
	"linked_market_action_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "model_decision_snapshots_run_source_check" CHECK ("model_decision_snapshots"."run_source" IN ('manual', 'cycle')),
	CONSTRAINT "model_decision_snapshots_run_shape_check" CHECK ((
      ("model_decision_snapshots"."run_source" = 'cycle' AND "model_decision_snapshots"."run_id" IS NOT NULL)
      OR
      ("model_decision_snapshots"."run_source" = 'manual' AND "model_decision_snapshots"."run_id" IS NULL)
    )),
	CONSTRAINT "model_decision_snapshots_binary_call_check" CHECK ("model_decision_snapshots"."binary_call" IN ('approved', 'rejected', 'yes', 'no')),
	CONSTRAINT "model_decision_snapshots_confidence_check" CHECK ("model_decision_snapshots"."confidence" >= 50 AND "model_decision_snapshots"."confidence" <= 100),
	CONSTRAINT "model_decision_snapshots_approval_probability_check" CHECK ("model_decision_snapshots"."approval_probability" >= 0 AND "model_decision_snapshots"."approval_probability" <= 1),
	CONSTRAINT "model_decision_snapshots_yes_probability_check" CHECK ("model_decision_snapshots"."yes_probability" IS NULL OR ("model_decision_snapshots"."yes_probability" >= 0 AND "model_decision_snapshots"."yes_probability" <= 1)),
	CONSTRAINT "model_decision_snapshots_ownership_check" CHECK ((
      ("model_decision_snapshots"."fda_event_id" IS NOT NULL AND "model_decision_snapshots"."trial_question_id" IS NULL)
      OR
      ("model_decision_snapshots"."fda_event_id" IS NULL AND "model_decision_snapshots"."trial_question_id" IS NOT NULL)
    )),
	CONSTRAINT "model_decision_snapshots_proposed_action_check" CHECK ("model_decision_snapshots"."proposed_action_type" IN ('BUY_YES', 'BUY_NO', 'SELL_YES', 'SELL_NO', 'HOLD')),
	CONSTRAINT "model_decision_snapshots_proposed_amount_check" CHECK ("model_decision_snapshots"."proposed_amount_usd" >= 0),
	CONSTRAINT "model_decision_snapshots_market_price_yes_check" CHECK ("model_decision_snapshots"."market_price_yes" IS NULL OR ("model_decision_snapshots"."market_price_yes" >= 0 AND "model_decision_snapshots"."market_price_yes" <= 1)),
	CONSTRAINT "model_decision_snapshots_market_price_no_check" CHECK ("model_decision_snapshots"."market_price_no" IS NULL OR ("model_decision_snapshots"."market_price_no" >= 0 AND "model_decision_snapshots"."market_price_no" <= 1)),
	CONSTRAINT "model_decision_snapshots_cash_available_check" CHECK ("model_decision_snapshots"."cash_available" IS NULL OR "model_decision_snapshots"."cash_available" >= 0),
	CONSTRAINT "model_decision_snapshots_yes_shares_held_check" CHECK ("model_decision_snapshots"."yes_shares_held" IS NULL OR "model_decision_snapshots"."yes_shares_held" >= 0),
	CONSTRAINT "model_decision_snapshots_no_shares_held_check" CHECK ("model_decision_snapshots"."no_shares_held" IS NULL OR "model_decision_snapshots"."no_shares_held" >= 0),
	CONSTRAINT "model_decision_snapshots_max_buy_usd_check" CHECK ("model_decision_snapshots"."max_buy_usd" IS NULL OR "model_decision_snapshots"."max_buy_usd" >= 0),
	CONSTRAINT "model_decision_snapshots_max_sell_yes_usd_check" CHECK ("model_decision_snapshots"."max_sell_yes_usd" IS NULL OR "model_decision_snapshots"."max_sell_yes_usd" >= 0),
	CONSTRAINT "model_decision_snapshots_max_sell_no_usd_check" CHECK ("model_decision_snapshots"."max_sell_no_usd" IS NULL OR "model_decision_snapshots"."max_sell_no_usd" >= 0),
	CONSTRAINT "model_decision_snapshots_cost_source_check" CHECK ("model_decision_snapshots"."cost_source" IS NULL OR "model_decision_snapshots"."cost_source" IN ('provider', 'estimated'))
);
--> statement-breakpoint
CREATE TABLE "phase2_trials" (
	"id" text PRIMARY KEY NOT NULL,
	"nct_number" text NOT NULL,
	"short_title" text NOT NULL,
	"sponsor_name" text NOT NULL,
	"sponsor_ticker" text,
	"indication" text NOT NULL,
	"exact_phase" text NOT NULL,
	"intervention" text NOT NULL,
	"primary_endpoint" text NOT NULL,
	"study_start_date" date,
	"est_primary_completion_date" date NOT NULL,
	"est_study_completion_date" date,
	"est_results_posting_date" date,
	"current_status" text NOT NULL,
	"est_enrollment" integer,
	"key_locations" text,
	"brief_summary" text NOT NULL,
	"standard_betting_markets" text,
	"last_monitored_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "phase2_trials_est_enrollment_check" CHECK ("phase2_trials"."est_enrollment" IS NULL OR "phase2_trials"."est_enrollment" >= 0)
);
--> statement-breakpoint
CREATE TABLE "prediction_markets" (
	"id" text PRIMARY KEY NOT NULL,
	"fda_event_id" text,
	"trial_question_id" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opening_probability" real NOT NULL,
	"b" real DEFAULT 25000 NOT NULL,
	"q_yes" real DEFAULT 0 NOT NULL,
	"q_no" real DEFAULT 0 NOT NULL,
	"price_yes" real DEFAULT 0.5 NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_outcome" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "prediction_markets_status_check" CHECK ("prediction_markets"."status" IN ('OPEN', 'RESOLVED')),
	CONSTRAINT "prediction_markets_opening_probability_check" CHECK ("prediction_markets"."opening_probability" >= 0 AND "prediction_markets"."opening_probability" <= 1),
	CONSTRAINT "prediction_markets_b_check" CHECK ("prediction_markets"."b" > 0),
	CONSTRAINT "prediction_markets_price_yes_check" CHECK ("prediction_markets"."price_yes" >= 0 AND "prediction_markets"."price_yes" <= 1),
	CONSTRAINT "prediction_markets_resolved_outcome_check" CHECK ("prediction_markets"."resolved_outcome" IS NULL OR "prediction_markets"."resolved_outcome" IN ('Approved', 'Rejected', 'YES', 'NO')),
	CONSTRAINT "prediction_markets_resolved_state_check" CHECK ((
      ("prediction_markets"."status" = 'OPEN' AND "prediction_markets"."resolved_outcome" IS NULL AND "prediction_markets"."resolved_at" IS NULL)
      OR
      ("prediction_markets"."status" = 'RESOLVED' AND "prediction_markets"."resolved_outcome" IS NOT NULL AND "prediction_markets"."resolved_at" IS NOT NULL)
    )),
	CONSTRAINT "prediction_markets_ownership_check" CHECK ((
      ("prediction_markets"."fda_event_id" IS NOT NULL AND "prediction_markets"."trial_question_id" IS NULL)
      OR
      ("prediction_markets"."fda_event_id" IS NULL AND "prediction_markets"."trial_question_id" IS NOT NULL)
    ))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "trial_monitor_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"web_search_enabled" boolean DEFAULT true NOT NULL,
	"run_interval_hours" integer DEFAULT 6 NOT NULL,
	"lookahead_days" integer DEFAULT 30 NOT NULL,
	"overdue_recheck_hours" integer DEFAULT 24 NOT NULL,
	"max_questions_per_run" integer DEFAULT 25 NOT NULL,
	"verifier_model_key" text DEFAULT 'gpt-5.4' NOT NULL,
	"min_candidate_confidence" real DEFAULT 0.8 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trial_monitor_configs_run_interval_hours_check" CHECK ("trial_monitor_configs"."run_interval_hours" >= 1 AND "trial_monitor_configs"."run_interval_hours" <= 168),
	CONSTRAINT "trial_monitor_configs_lookahead_days_check" CHECK ("trial_monitor_configs"."lookahead_days" >= 0 AND "trial_monitor_configs"."lookahead_days" <= 365),
	CONSTRAINT "trial_monitor_configs_overdue_recheck_hours_check" CHECK ("trial_monitor_configs"."overdue_recheck_hours" >= 1 AND "trial_monitor_configs"."overdue_recheck_hours" <= 720),
	CONSTRAINT "trial_monitor_configs_max_questions_per_run_check" CHECK ("trial_monitor_configs"."max_questions_per_run" >= 1 AND "trial_monitor_configs"."max_questions_per_run" <= 500),
	CONSTRAINT "trial_monitor_configs_min_candidate_confidence_check" CHECK ("trial_monitor_configs"."min_candidate_confidence" >= 0 AND "trial_monitor_configs"."min_candidate_confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "trial_monitor_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger_source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"questions_scanned" integer DEFAULT 0 NOT NULL,
	"candidates_created" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"debug_log" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trial_monitor_runs_trigger_source_check" CHECK ("trial_monitor_runs"."trigger_source" IN ('cron', 'manual')),
	CONSTRAINT "trial_monitor_runs_status_check" CHECK ("trial_monitor_runs"."status" IN ('running', 'completed', 'failed')),
	CONSTRAINT "trial_monitor_runs_questions_scanned_check" CHECK ("trial_monitor_runs"."questions_scanned" >= 0),
	CONSTRAINT "trial_monitor_runs_candidates_created_check" CHECK ("trial_monitor_runs"."candidates_created" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trial_outcome_candidate_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"source_type" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"published_at" timestamp with time zone,
	"excerpt" text NOT NULL,
	"domain" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trial_outcome_candidate_evidence_source_type_check" CHECK ("trial_outcome_candidate_evidence"."source_type" IN ('clinicaltrials', 'sponsor', 'stored_source', 'web_search'))
);
--> statement-breakpoint
CREATE TABLE "trial_outcome_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"trial_question_id" text NOT NULL,
	"proposed_outcome" text NOT NULL,
	"proposed_outcome_date" timestamp with time zone,
	"confidence" real NOT NULL,
	"summary" text NOT NULL,
	"verifier_model_key" text NOT NULL,
	"provider_response_id" text,
	"evidence_hash" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reviewed_by_user_id" text,
	"review_notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "trial_outcome_candidates_proposed_outcome_check" CHECK ("trial_outcome_candidates"."proposed_outcome" IN ('YES', 'NO', 'NO_DECISION')),
	CONSTRAINT "trial_outcome_candidates_confidence_check" CHECK ("trial_outcome_candidates"."confidence" >= 0 AND "trial_outcome_candidates"."confidence" <= 1),
	CONSTRAINT "trial_outcome_candidates_status_check" CHECK ("trial_outcome_candidates"."status" IN ('pending_review', 'accepted', 'rejected', 'superseded', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "trial_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"trial_id" text NOT NULL,
	"slug" text NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'coming_soon' NOT NULL,
	"is_bettable" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	"outcome" text DEFAULT 'Pending' NOT NULL,
	"outcome_date" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trial_questions_status_check" CHECK ("trial_questions"."status" IN ('live', 'coming_soon')),
	CONSTRAINT "trial_questions_outcome_check" CHECK ("trial_questions"."outcome" IN ('Pending', 'YES', 'NO')),
	CONSTRAINT "trial_questions_sort_order_check" CHECK ("trial_questions"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trial_sync_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync_interval_hours" integer DEFAULT 24 NOT NULL,
	"recent_completion_lookback_days" integer DEFAULT 180 NOT NULL,
	"reconcile_interval_hours" integer DEFAULT 168 NOT NULL,
	"last_successful_update_post_date" date,
	"last_successful_data_timestamp" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trial_sync_configs_sync_interval_hours_check" CHECK ("trial_sync_configs"."sync_interval_hours" >= 1 AND "trial_sync_configs"."sync_interval_hours" <= 168),
	CONSTRAINT "trial_sync_configs_recent_completion_lookback_days_check" CHECK ("trial_sync_configs"."recent_completion_lookback_days" >= 1 AND "trial_sync_configs"."recent_completion_lookback_days" <= 1095),
	CONSTRAINT "trial_sync_configs_reconcile_interval_hours_check" CHECK ("trial_sync_configs"."reconcile_interval_hours" >= 1 AND "trial_sync_configs"."reconcile_interval_hours" <= 720)
);
--> statement-breakpoint
CREATE TABLE "trial_sync_run_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"trial_id" text,
	"nct_number" text NOT NULL,
	"short_title" text NOT NULL,
	"sponsor_name" text NOT NULL,
	"current_status" text NOT NULL,
	"est_primary_completion_date" date NOT NULL,
	"change_type" text NOT NULL,
	"change_summary" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trial_sync_run_items_change_type_check" CHECK ("trial_sync_run_items"."change_type" IN ('inserted', 'updated'))
);
--> statement-breakpoint
CREATE TABLE "trial_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger_source" text DEFAULT 'manual' NOT NULL,
	"mode" text DEFAULT 'incremental' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"source_data_timestamp" text,
	"studies_fetched" integer DEFAULT 0 NOT NULL,
	"studies_matched" integer DEFAULT 0 NOT NULL,
	"trials_upserted" integer DEFAULT 0 NOT NULL,
	"questions_upserted" integer DEFAULT 0 NOT NULL,
	"markets_opened" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trial_sync_runs_trigger_source_check" CHECK ("trial_sync_runs"."trigger_source" IN ('cron', 'manual')),
	CONSTRAINT "trial_sync_runs_mode_check" CHECK ("trial_sync_runs"."mode" IN ('incremental', 'reconcile')),
	CONSTRAINT "trial_sync_runs_status_check" CHECK ("trial_sync_runs"."status" IN ('running', 'completed', 'failed', 'skipped')),
	CONSTRAINT "trial_sync_runs_studies_fetched_check" CHECK ("trial_sync_runs"."studies_fetched" >= 0),
	CONSTRAINT "trial_sync_runs_studies_matched_check" CHECK ("trial_sync_runs"."studies_matched" >= 0),
	CONSTRAINT "trial_sync_runs_trials_upserted_check" CHECK ("trial_sync_runs"."trials_upserted" >= 0),
	CONSTRAINT "trial_sync_runs_questions_upserted_check" CHECK ("trial_sync_runs"."questions_upserted" >= 0),
	CONSTRAINT "trial_sync_runs_markets_opened_check" CHECK ("trial_sync_runs"."markets_opened" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"signup_location" text,
	"signup_state" text,
	"password_hash" text,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"predictions" integer DEFAULT 0,
	"correct_preds" integer DEFAULT 0,
	"x_user_id" text,
	"x_username" text,
	"x_connected_at" timestamp with time zone,
	"tweet_challenge_token_hash" text,
	"tweet_challenge_expires_at" timestamp with time zone,
	"tweet_verified_at" timestamp with time zone,
	"tweet_verified_tweet_id" text,
	"tweet_must_stay_until" timestamp with time zone,
	"points_balance" integer DEFAULT 5 NOT NULL,
	"last_points_refill_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_display_name_check" CHECK ("users"."name" ~ '^[A-Za-z0-9]{1,20}$'),
	CONSTRAINT "users_points_balance_check" CHECK ("users"."points_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_outcome_candidate_evidence" ADD CONSTRAINT "event_outcome_candidate_evidence_candidate_id_event_outcome_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."event_outcome_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_outcome_candidates" ADD CONSTRAINT "event_outcome_candidates_event_id_fda_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."fda_calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_outcome_candidates" ADD CONSTRAINT "event_outcome_candidates_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fda_event_analyses" ADD CONSTRAINT "fda_event_analyses_event_id_fda_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."fda_calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fda_event_contexts" ADD CONSTRAINT "fda_event_contexts_event_id_fda_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."fda_calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fda_event_external_ids" ADD CONSTRAINT "fda_event_external_ids_event_id_fda_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."fda_calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fda_event_sources" ADD CONSTRAINT "fda_event_sources_event_id_fda_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."fda_calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_accounts" ADD CONSTRAINT "market_accounts_actor_id_market_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."market_actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_actions" ADD CONSTRAINT "market_actions_run_id_market_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."market_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_actions" ADD CONSTRAINT "market_actions_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_actions" ADD CONSTRAINT "market_actions_fda_event_id_fda_calendar_events_id_fk" FOREIGN KEY ("fda_event_id") REFERENCES "public"."fda_calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_actions" ADD CONSTRAINT "market_actions_trial_question_id_trial_questions_id_fk" FOREIGN KEY ("trial_question_id") REFERENCES "public"."trial_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_actions" ADD CONSTRAINT "market_actions_actor_id_market_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."market_actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_actors" ADD CONSTRAINT "market_actors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_daily_snapshots" ADD CONSTRAINT "market_daily_snapshots_actor_id_market_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."market_actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_positions" ADD CONSTRAINT "market_positions_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_positions" ADD CONSTRAINT "market_positions_actor_id_market_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."market_actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_run_logs" ADD CONSTRAINT "market_run_logs_run_id_market_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."market_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_run_logs" ADD CONSTRAINT "market_run_logs_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_run_logs" ADD CONSTRAINT "market_run_logs_fda_event_id_fda_calendar_events_id_fk" FOREIGN KEY ("fda_event_id") REFERENCES "public"."fda_calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_run_logs" ADD CONSTRAINT "market_run_logs_trial_question_id_trial_questions_id_fk" FOREIGN KEY ("trial_question_id") REFERENCES "public"."trial_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_run_logs" ADD CONSTRAINT "market_run_logs_actor_id_market_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."market_actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ADD CONSTRAINT "model_decision_snapshots_run_id_market_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."market_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ADD CONSTRAINT "model_decision_snapshots_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ADD CONSTRAINT "model_decision_snapshots_fda_event_id_fda_calendar_events_id_fk" FOREIGN KEY ("fda_event_id") REFERENCES "public"."fda_calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ADD CONSTRAINT "model_decision_snapshots_trial_question_id_trial_questions_id_fk" FOREIGN KEY ("trial_question_id") REFERENCES "public"."trial_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ADD CONSTRAINT "model_decision_snapshots_actor_id_market_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."market_actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_decision_snapshots" ADD CONSTRAINT "model_decision_snapshots_linked_market_action_id_market_actions_id_fk" FOREIGN KEY ("linked_market_action_id") REFERENCES "public"."market_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_markets" ADD CONSTRAINT "prediction_markets_fda_event_id_fda_calendar_events_id_fk" FOREIGN KEY ("fda_event_id") REFERENCES "public"."fda_calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_markets" ADD CONSTRAINT "prediction_markets_trial_question_id_trial_questions_id_fk" FOREIGN KEY ("trial_question_id") REFERENCES "public"."trial_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_outcome_candidate_evidence" ADD CONSTRAINT "trial_outcome_candidate_evidence_candidate_id_trial_outcome_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."trial_outcome_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_outcome_candidates" ADD CONSTRAINT "trial_outcome_candidates_trial_question_id_trial_questions_id_fk" FOREIGN KEY ("trial_question_id") REFERENCES "public"."trial_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_outcome_candidates" ADD CONSTRAINT "trial_outcome_candidates_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_questions" ADD CONSTRAINT "trial_questions_trial_id_phase2_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."phase2_trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_sync_run_items" ADD CONSTRAINT "trial_sync_run_items_run_id_trial_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."trial_sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_sync_run_items" ADD CONSTRAINT "trial_sync_run_items_trial_id_phase2_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."phase2_trials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_messages_created_at_idx" ON "contact_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "crash_events_fingerprint_idx" ON "crash_events" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "crash_events_created_at_idx" ON "crash_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "crash_events_digest_idx" ON "crash_events" USING btree ("digest");--> statement-breakpoint
CREATE INDEX "crash_events_path_idx" ON "crash_events" USING btree ("path");--> statement-breakpoint
CREATE INDEX "crash_events_source_idx" ON "crash_events" USING btree ("source");--> statement-breakpoint
CREATE INDEX "event_monitor_runs_started_at_idx" ON "event_monitor_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "event_outcome_candidate_evidence_candidate_display_order_idx" ON "event_outcome_candidate_evidence" USING btree ("candidate_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "event_outcome_candidates_event_outcome_hash_idx" ON "event_outcome_candidates" USING btree ("event_id","proposed_outcome","evidence_hash");--> statement-breakpoint
CREATE INDEX "event_outcome_candidates_status_created_at_idx" ON "event_outcome_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "event_outcome_candidates_event_created_at_idx" ON "event_outcome_candidates" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fda_calendar_events_identity_idx" ON "fda_calendar_events" USING btree ("company_name","drug_name","application_type","decision_date");--> statement-breakpoint
CREATE INDEX "fda_calendar_events_decision_date_idx" ON "fda_calendar_events" USING btree ("decision_date");--> statement-breakpoint
CREATE INDEX "fda_calendar_events_outcome_idx" ON "fda_calendar_events" USING btree ("outcome");--> statement-breakpoint
CREATE UNIQUE INDEX "fda_event_analyses_event_type_idx" ON "fda_event_analyses" USING btree ("event_id","analysis_type");--> statement-breakpoint
CREATE UNIQUE INDEX "fda_event_external_ids_event_id_type_idx" ON "fda_event_external_ids" USING btree ("event_id","id_type");--> statement-breakpoint
CREATE INDEX "fda_event_external_ids_type_value_idx" ON "fda_event_external_ids" USING btree ("id_type","id_value");--> statement-breakpoint
CREATE UNIQUE INDEX "fda_event_sources_event_source_url_idx" ON "fda_event_sources" USING btree ("event_id","source_type","url");--> statement-breakpoint
CREATE INDEX "fda_event_sources_event_source_order_idx" ON "fda_event_sources" USING btree ("event_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "market_accounts_actor_id_idx" ON "market_accounts" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_actions_market_actor_run_idx" ON "market_actions" USING btree ("market_id","actor_id","run_date") WHERE "market_actions"."action_source" = 'cycle';--> statement-breakpoint
CREATE INDEX "market_actions_run_id_idx" ON "market_actions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "market_actions_market_created_idx" ON "market_actions" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "market_actions_actor_idx" ON "market_actions" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "market_actions_actor_created_idx" ON "market_actions" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "market_actions_action_source_idx" ON "market_actions" USING btree ("action_source");--> statement-breakpoint
CREATE INDEX "market_actions_status_idx" ON "market_actions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "market_actors_model_key_idx" ON "market_actors" USING btree ("model_key");--> statement-breakpoint
CREATE UNIQUE INDEX "market_actors_user_id_idx" ON "market_actors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "market_actors_actor_type_idx" ON "market_actors" USING btree ("actor_type");--> statement-breakpoint
CREATE UNIQUE INDEX "market_daily_snapshots_actor_date_idx" ON "market_daily_snapshots" USING btree ("actor_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "market_daily_snapshots_actor_idx" ON "market_daily_snapshots" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_positions_market_actor_idx" ON "market_positions" USING btree ("market_id","actor_id");--> statement-breakpoint
CREATE INDEX "market_positions_market_idx" ON "market_positions" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "market_positions_actor_idx" ON "market_positions" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_price_snapshots_market_date_idx" ON "market_price_snapshots" USING btree ("market_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "market_price_snapshots_market_idx" ON "market_price_snapshots" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "market_run_logs_run_created_idx" ON "market_run_logs" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "market_run_logs_created_at_idx" ON "market_run_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "market_run_logs_actor_idx" ON "market_run_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "market_runs_run_date_idx" ON "market_runs" USING btree ("run_date");--> statement-breakpoint
CREATE INDEX "market_runs_status_idx" ON "market_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "market_runs_created_at_idx" ON "market_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "model_decision_snapshots_run_id_idx" ON "model_decision_snapshots" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "model_decision_snapshots_run_date_run_source_idx" ON "model_decision_snapshots" USING btree ("run_date","run_source");--> statement-breakpoint
CREATE INDEX "model_decision_snapshots_event_actor_created_idx" ON "model_decision_snapshots" USING btree ("fda_event_id","actor_id","created_at");--> statement-breakpoint
CREATE INDEX "model_decision_snapshots_question_actor_created_idx" ON "model_decision_snapshots" USING btree ("trial_question_id","actor_id","created_at");--> statement-breakpoint
CREATE INDEX "model_decision_snapshots_market_actor_created_idx" ON "model_decision_snapshots" USING btree ("market_id","actor_id","created_at");--> statement-breakpoint
CREATE INDEX "model_decision_snapshots_market_actor_run_date_created_idx" ON "model_decision_snapshots" USING btree ("market_id","actor_id","run_date","created_at");--> statement-breakpoint
CREATE INDEX "model_decision_snapshots_run_source_idx" ON "model_decision_snapshots" USING btree ("run_source");--> statement-breakpoint
CREATE UNIQUE INDEX "phase2_trials_nct_number_idx" ON "phase2_trials" USING btree ("nct_number");--> statement-breakpoint
CREATE INDEX "phase2_trials_primary_completion_idx" ON "phase2_trials" USING btree ("est_primary_completion_date");--> statement-breakpoint
CREATE INDEX "phase2_trials_sponsor_ticker_idx" ON "phase2_trials" USING btree ("sponsor_ticker");--> statement-breakpoint
CREATE INDEX "phase2_trials_current_status_idx" ON "phase2_trials" USING btree ("current_status");--> statement-breakpoint
CREATE UNIQUE INDEX "prediction_markets_fda_event_id_idx" ON "prediction_markets" USING btree ("fda_event_id") WHERE "prediction_markets"."fda_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "prediction_markets_trial_question_id_idx" ON "prediction_markets" USING btree ("trial_question_id") WHERE "prediction_markets"."trial_question_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "prediction_markets_status_idx" ON "prediction_markets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trial_monitor_runs_started_at_idx" ON "trial_monitor_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "trial_outcome_candidate_evidence_candidate_display_order_idx" ON "trial_outcome_candidate_evidence" USING btree ("candidate_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_outcome_candidates_question_outcome_hash_idx" ON "trial_outcome_candidates" USING btree ("trial_question_id","proposed_outcome","evidence_hash");--> statement-breakpoint
CREATE INDEX "trial_outcome_candidates_status_created_at_idx" ON "trial_outcome_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "trial_outcome_candidates_question_created_at_idx" ON "trial_outcome_candidates" USING btree ("trial_question_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_questions_trial_slug_idx" ON "trial_questions" USING btree ("trial_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_questions_trial_sort_order_idx" ON "trial_questions" USING btree ("trial_id","sort_order");--> statement-breakpoint
CREATE INDEX "trial_questions_slug_idx" ON "trial_questions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "trial_questions_status_idx" ON "trial_questions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trial_questions_outcome_idx" ON "trial_questions" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "trial_sync_run_items_run_created_at_idx" ON "trial_sync_run_items" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "trial_sync_run_items_run_change_type_idx" ON "trial_sync_run_items" USING btree ("run_id","change_type");--> statement-breakpoint
CREATE INDEX "trial_sync_run_items_nct_number_idx" ON "trial_sync_run_items" USING btree ("nct_number");--> statement-breakpoint
CREATE INDEX "trial_sync_runs_started_at_idx" ON "trial_sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "trial_sync_runs_mode_started_at_idx" ON "trial_sync_runs" USING btree ("mode","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_x_user_id_idx" ON "users" USING btree ("x_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_email_unique_idx" ON "waitlist_entries" USING btree ("email");
