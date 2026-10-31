CREATE TABLE "sync_base" (
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"rev" bigint NOT NULL,
	"local_rev" bigint NOT NULL,
	"hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "sync_base_kind_id_pk" PRIMARY KEY("kind","id")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"cursor" text DEFAULT '0' NOT NULL,
	"synced_at" timestamp with time zone,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
