ALTER TABLE "pages" ADD COLUMN "is_inbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pages_inbox_idx" ON "pages" USING btree ("is_inbox") WHERE is_inbox;