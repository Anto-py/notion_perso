CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"page_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"type" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"icon" text,
	"body" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"db_config" jsonb,
	"db_id" text,
	"property_values" jsonb,
	"values_text" text DEFAULT '' NOT NULL,
	"inbox_kind" text,
	"manual_order" integer DEFAULT 0 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('french', f_unaccent(title || ' ' || body_text || ' ' || values_text))) STORED,
	"share_enabled" boolean DEFAULT false NOT NULL,
	"public_id" text,
	"share_include_subpages" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trashed_at" timestamp with time zone,
	CONSTRAINT "pages_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_id_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_db_id_pages_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pages_search_vector_idx" ON "pages" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "pages_parent_id_idx" ON "pages" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "pages_db_id_idx" ON "pages" USING btree ("db_id");--> statement-breakpoint
CREATE INDEX "pages_trashed_at_idx" ON "pages" USING btree ("trashed_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");