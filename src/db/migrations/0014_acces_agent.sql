CREATE TABLE "agent_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_id" text NOT NULL,
	"model" text,
	"action" text NOT NULL,
	"page_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"model" text,
	"action" text NOT NULL,
	"page_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decision" text
);
--> statement-breakpoint
CREATE TABLE "agent_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "agent_log_at_idx" ON "agent_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "agent_requests_open_idx" ON "agent_requests" USING btree ("created_at") WHERE "agent_requests"."decided_at" is null;