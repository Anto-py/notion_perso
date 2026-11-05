ALTER TABLE "pages" ADD COLUMN "is_bases_root" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pages_bases_root_idx" ON "pages" USING btree ("is_bases_root") WHERE is_bases_root;--> statement-breakpoint
-- Racine « Bases » (étape 16). Id et dates fixes : chaque instance (serveur,
-- Mac) pose la même ligne, que la synchronisation lit comme identique.
INSERT INTO "pages" ("id", "type", "title", "icon", "is_bases_root", "created_at", "updated_at")
SELECT 'pg_basesracine00000', 'folder', 'Bases', '🗂️', true, '2026-11-05T00:00:00Z', '2026-11-05T00:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE "is_bases_root" OR "id" = 'pg_basesracine00000');
