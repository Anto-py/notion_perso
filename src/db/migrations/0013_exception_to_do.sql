ALTER TABLE "pages" ADD COLUMN "root_exception" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pages_root_exception_idx" ON "pages" USING btree ("root_exception") WHERE root_exception;--> statement-breakpoint
-- Exception To Do : la base vivante de ce titre peut vivre à la racine de
-- l'arbre. La plus ancienne, le doublon de 13h03 étant déjà en corbeille.
UPDATE "pages" SET "root_exception" = true
WHERE "id" = (
  SELECT "id" FROM "pages"
  WHERE "type" = 'database' AND "trashed_at" IS NULL AND lower(trim("title")) = 'to do'
  ORDER BY "created_at" ASC
  LIMIT 1
);