-- Synchronisation avec l'app Mac (SPECS.md) : révision et transaction de chaque
-- ligne de pages, media, icon_images, journal des suppressions, clients.
-- Fonctions et déclencheurs écrits à la main en fin de fichier.
CREATE SEQUENCE "public"."sync_rev_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "deletions" (
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"rev" bigint NOT NULL,
	"sync_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletions_kind_id_pk" PRIMARY KEY("kind","id")
);
--> statement-breakpoint
CREATE TABLE "sync_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"cursor" "xid8" DEFAULT '0'::xid8 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_clients_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "icon_images" ADD COLUMN "rev" bigint DEFAULT nextval('sync_rev_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "icon_images" ADD COLUMN "sync_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "rev" bigint DEFAULT nextval('sync_rev_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "sync_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "rev" bigint DEFAULT nextval('sync_rev_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "sync_xid" "xid8" DEFAULT pg_current_xact_id() NOT NULL;--> statement-breakpoint
CREATE INDEX "deletions_sync_xid_idx" ON "deletions" USING btree ("sync_xid");--> statement-breakpoint
CREATE INDEX "icon_images_sync_xid_idx" ON "icon_images" USING btree ("sync_xid");--> statement-breakpoint
CREATE INDEX "media_sync_xid_idx" ON "media" USING btree ("sync_xid");--> statement-breakpoint
CREATE INDEX "pages_sync_xid_idx" ON "pages" USING btree ("sync_xid");--> statement-breakpoint
-- Tampon posé à chaque écriture, quelle qu'en soit la source (lib/, import,
-- cascade ON DELETE SET NULL) : aucune fonction de lib/ n'a à y penser.
CREATE FUNCTION sync_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.rev := nextval('sync_rev_seq');
  NEW.sync_xid := pg_current_xact_id();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pages_sync_stamp BEFORE INSERT OR UPDATE ON pages FOR EACH ROW EXECUTE FUNCTION sync_stamp();
--> statement-breakpoint
CREATE TRIGGER media_sync_stamp BEFORE INSERT OR UPDATE ON media FOR EACH ROW EXECUTE FUNCTION sync_stamp();
--> statement-breakpoint
CREATE TRIGGER icon_images_sync_stamp BEFORE INSERT OR UPDATE ON icon_images FOR EACH ROW EXECUTE FUNCTION sync_stamp();
--> statement-breakpoint
-- Suppression journalisée, cascades comprises (entrées d'une base purgée,
-- entrée de bibliothèque d'un média effacé). Une ligne par objet.
CREATE FUNCTION sync_log_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO deletions (kind, id, rev) VALUES (TG_ARGV[0], OLD.id, nextval('sync_rev_seq'))
  ON CONFLICT (kind, id) DO UPDATE
    SET rev = EXCLUDED.rev, sync_xid = pg_current_xact_id(), deleted_at = now();
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pages_sync_deletion AFTER DELETE ON pages FOR EACH ROW EXECUTE FUNCTION sync_log_deletion('page');
--> statement-breakpoint
CREATE TRIGGER media_sync_deletion AFTER DELETE ON media FOR EACH ROW EXECUTE FUNCTION sync_log_deletion('media');
--> statement-breakpoint
CREATE TRIGGER icon_images_sync_deletion AFTER DELETE ON icon_images FOR EACH ROW EXECUTE FUNCTION sync_log_deletion('icon_image');
