// Tables Drizzle (SPECS.md, « Modèle de données »). L'extension unaccent et
// f_unaccent viennent de la migration SQL 0000_extensions.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

// Identifiant de transaction 64 bits de PostgreSQL, lu comme une chaîne.
const xid8 = customType<{ data: string }>({
  dataType: () => "xid8",
});

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// Synchronisation (SPECS.md, « Synchronisation avec l'app Mac »), sur pages,
// media et icon_images. rev : version de la ligne, tirée d'une séquence
// unique. sync_xid : transaction qui l'a écrite, curseur du flux des
// changements (une révision prise par une transaction encore ouverte peut
// être dépassée par une plus récente déjà validée). Le déclencheur
// sync_stamp (migration 0007) pose les deux à chaque écriture ; les défauts ne
// servent qu'aux lignes existantes quand les colonnes apparaissent. Jamais
// écrits par lib/, jamais l'horloge d'un appareil.
export const syncRevSeq = pgSequence("sync_rev_seq");
const rev = () =>
  bigint("rev", { mode: "number" })
    .notNull()
    .default(sql`nextval('sync_rev_seq')`);
const syncXid = () =>
  xid8("sync_xid")
    .notNull()
    .default(sql`pg_current_xact_id()`);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

// On stocke l'empreinte du jeton, jamais le jeton : une fuite de la base ne
// donne aucune session utilisable.
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey(),
    // set null : une page dont le parent est purgé remonte à la racine.
    parentId: text("parent_id").references((): AnyPgColumn => pages.id, {
      onDelete: "set null",
    }),
    type: text("type", { enum: ["page", "database", "entry"] }).notNull(),
    title: text("title").notNull().default(""),
    icon: text("icon"),
    // Bandeau : "color:<teinte>" ou "image:<fichier>", comme icon (lib/covers.ts).
    cover: text("cover"),
    // Recadrage vertical de l'image du bandeau, 0 en haut et 100 en bas. Une
    // couleur l'ignore ; le défaut reste 50 pour ne pas dépendre de l'affichage.
    coverPosition: integer("cover_position"),
    body: jsonb("body").notNull().default(sql`'[]'::jsonb`),
    bodyText: text("body_text").notNull().default(""),
    dbConfig: jsonb("db_config"),
    // cascade : purger une base purge ses entrées.
    dbId: text("db_id").references((): AnyPgColumn => pages.id, {
      onDelete: "cascade",
    }),
    propertyValues: jsonb("property_values"),
    // Valeurs des propriétés aplaties, remplies à l'écriture comme body_text :
    // une colonne générée ne sait pas parcourir property_values selon db_config.
    valuesText: text("values_text").notNull().default(""),
    inboxKind: text("inbox_kind", { enum: ["link", "note"] }),
    // La base Vide-cerveau, une seule : l'index unique partiel ci-dessous
    // garantit qu'une seconde ligne ne peut pas porter le rôle.
    isInbox: boolean("is_inbox").notNull().default(false),
    // Clé d'ordre fractionnaire (lib/order_key.ts), triée octet par octet :
    // la migration 0008 pose COLLATE "C", que Drizzle ne sait pas déclarer.
    manualOrder: text("manual_order").notNull().default("a0"),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('french', f_unaccent(title || ' ' || body_text || ' ' || values_text))`,
    ),
    shareEnabled: boolean("share_enabled").notNull().default(false),
    publicId: text("public_id").unique(),
    shareIncludeSubpages: boolean("share_include_subpages")
      .notNull()
      .default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    rev: rev(),
    syncXid: syncXid(),
  },
  (t) => [
    index("pages_search_vector_idx").using("gin", t.searchVector),
    index("pages_parent_id_idx").on(t.parentId),
    index("pages_db_id_idx").on(t.dbId),
    index("pages_trashed_at_idx").on(t.trashedAt),
    uniqueIndex("pages_inbox_idx").on(t.isInbox).where(sql`is_inbox`),
    index("pages_sync_xid_idx").on(t.syncXid),
  ],
);

export const media = pgTable(
  "media",
  {
    id: text("id").primaryKey(),
    filename: text("filename").notNull(),
    originalName: text("original_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    // set null : indicatif, le nettoyage (lib/media_cleanup_query.ts) lit les
    // citations, pas ce rattachement.
    pageId: text("page_id").references(() => pages.id, { onDelete: "set null" }),
    // Nul tant que le fichier sert ; date du premier balayage qui l'a trouvé
    // inutilisé. Effacé MEDIA_RETENTION_DAYS plus tard s'il l'est resté.
    unusedSince: timestamp("unused_since", { withTimezone: true }),
    createdAt: createdAt(),
    rev: rev(),
    syncXid: syncXid(),
  },
  (t) => [index("media_sync_xid_idx").on(t.syncXid)],
);

// Bibliothèque des images d'icône. Une page pointe vers le fichier
// (pages.icon = "image:<filename>") et le nom vit ici seul : renommer vaut
// partout. cascade : supprimer le média supprime l'entrée de bibliothèque.
export const iconImages = pgTable(
  "icon_images",
  {
    id: text("id").primaryKey(),
    mediaId: text("media_id")
      .notNull()
      .unique()
      .references(() => media.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Retirée de la bibliothèque, toujours servie aux pages qui l'utilisent.
    hidden: boolean("hidden").notNull().default(false),
    createdAt: createdAt(),
    rev: rev(),
    syncXid: syncXid(),
  },
  (t) => [index("icon_images_sync_xid_idx").on(t.syncXid)],
);

// Lignes effacées (page purgée, média nettoyé, icône supprimée), remplies par
// le déclencheur sync_log_deletion (migration 0007) : le Mac les lit avec les
// changements, par révision. Une ligne par objet, la dernière suppression
// l'emporte.
export const deletions = pgTable(
  "deletions",
  {
    kind: text("kind", { enum: ["page", "media", "icon_image"] }).notNull(),
    id: text("id").notNull(),
    rev: bigint("rev", { mode: "number" }).notNull(),
    syncXid: syncXid(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.id] }), index("deletions_sync_xid_idx").on(t.syncXid)],
);

// Clients de synchronisation (l'app Mac). Comme pour les sessions, seule
// l'empreinte du jeton est gardée ; supprimer la ligne révoque l'accès.
// cursor : xmin de l'instantané de sa dernière lecture complète des changements.
export const syncClients = pgTable("sync_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  cursor: xid8("cursor").notNull().default(sql`'0'::xid8`),
  createdAt: createdAt(),
});

// Côté Mac seulement (vides sur le VPS) : la dernière version reçue du
// serveur pour chaque ligne synchronisée. rev : sa révision sur le serveur.
// local_rev : la révision locale vue au dernier passage, pré-filtre qui évite
// de recalculer l'empreinte des lignes que rien n'a touchées. Une ligne dont
// l'empreinte diffère de hash attend d'être envoyée (lib/sync_client.ts).
export const syncBase = pgTable(
  "sync_base",
  {
    kind: text("kind", { enum: ["page", "media", "icon_image"] }).notNull(),
    id: text("id").notNull(),
    rev: bigint("rev", { mode: "number" }).notNull(),
    localRev: bigint("local_rev", { mode: "number" }).notNull(),
    hash: text("hash").notNull(),
    snapshot: jsonb("snapshot").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.id] })],
);

// Côté Mac seulement : une ligne unique (id 1). cursor : curseur du flux des
// changements, à renvoyer au cycle suivant ; synced_at : fin du dernier cycle
// réussi ; error : raison du dernier échec, effacée au succès suivant.
export const syncState = pgTable("sync_state", {
  id: integer("id").primaryKey().default(1),
  cursor: text("cursor").notNull().default("0"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  error: text("error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
