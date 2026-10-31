// Tables Drizzle (SPECS.md, « Modèle de données »). L'extension unaccent et
// f_unaccent viennent de la migration SQL 0000_extensions.
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

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
    manualOrder: integer("manual_order").notNull().default(0),
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
  },
  (t) => [
    index("pages_search_vector_idx").using("gin", t.searchVector),
    index("pages_parent_id_idx").on(t.parentId),
    index("pages_db_id_idx").on(t.dbId),
    index("pages_trashed_at_idx").on(t.trashedAt),
    uniqueIndex("pages_inbox_idx").on(t.isInbox).where(sql`is_inbox`),
  ],
);

export const media = pgTable("media", {
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
});

// Bibliothèque des images d'icône. Une page pointe vers le fichier
// (pages.icon = "image:<filename>") et le nom vit ici seul : renommer vaut
// partout. cascade : supprimer le média supprime l'entrée de bibliothèque.
export const iconImages = pgTable("icon_images", {
  id: text("id").primaryKey(),
  mediaId: text("media_id")
    .notNull()
    .unique()
    .references(() => media.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Retirée de la bibliothèque, toujours servie aux pages qui l'utilisent.
  hidden: boolean("hidden").notNull().default(false),
  createdAt: createdAt(),
});
