ALTER TABLE "users" ADD COLUMN "privy_user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "embedded_wallet_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_provisioning_status" text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_provisioned_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_privy_user_id_idx" ON "users" USING btree ("privy_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_wallet_provisioning_status_check" CHECK ("users"."wallet_provisioning_status" IN ('not_started', 'provisioning', 'provisioned', 'error'));
