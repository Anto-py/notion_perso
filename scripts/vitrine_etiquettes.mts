// npm run vitrine:etiquettes : corrige les libellés de la propriété Domaine de
// la base de la vitrine (PLAN, étape 12) sur la base désignée par DATABASE_URL.
// À blanc par défaut ; --write applique les écritures en une transaction.
// --base <id> lève l'ambiguïté quand plusieurs bases portent un Domaine.
//   npm run vitrine:etiquettes
//   npm run vitrine:etiquettes -- --write
//
// Seul le nom des options change, leur id reste : les valeurs des entrées
// suivent. Le texte dérivé values_text, qui recopie les noms pour la
// recherche, est recalculé sur les entrées où il diffère.
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pages } from "../src/db/schema.ts";
import { asValues, valuesToText } from "../src/lib/property_values.ts";
import { fold, type Property } from "../src/lib/property_schema.ts";
import { applyLabelFixes, planLabelFixes, type LabelFix } from "../src/lib/vitrine_labels.ts";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("Usage : DATABASE_URL=… npm run vitrine:etiquettes [-- --write] [--base <id>]");
  process.exit(1);
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const baseArg = args.includes("--base")
  ? args[args.indexOf("--base") + 1]
  : args.find((arg) => arg.startsWith("--base="))?.slice("--base=".length);

type RawConfig = { properties?: unknown; views?: unknown; vitrine?: unknown };
type Candidate = { id: string; title: string; config: RawConfig; properties: Property[]; domaine: Property; enabled: boolean };

function asConfig(raw: unknown): RawConfig {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as RawConfig) : {};
}

function asProperties(config: RawConfig): Property[] {
  return Array.isArray(config.properties) ? (config.properties as Property[]) : [];
}

function domaineOf(properties: readonly Property[]): Property | undefined {
  return properties.find((prop) => prop.type === "multiselect" && fold(prop.name.trim()) === "domaine");
}

function describeFixes(fixes: readonly LabelFix[]): string {
  if (!fixes.length) return "Aucune étiquette à corriger.";
  return fixes.map((fix) => `- « ${fix.from} » → « ${fix.to} »  (${fix.id})`).join("\n");
}

// Base visée : celle que le drapeau nomme ; sinon l'unique base à « Domaine »,
// sinon celle dont la vitrine est active, sinon « Ressources numériques » (la
// base nommée par IDEA). Plusieurs candidats sans critère : refus explicite.
function pickCandidate(candidates: readonly Candidate[]): Candidate {
  if (baseArg) {
    const named = candidates.find((candidate) => candidate.id === baseArg);
    if (!named) {
      console.error(`La base ${baseArg} n'est pas dans la liste : ${candidates.map((c) => c.id).join(", ") || "aucune"}.`);
      process.exit(1);
    }
    return named;
  }
  if (candidates.length === 1) return candidates[0];
  const enabled = candidates.filter((candidate) => candidate.enabled);
  if (enabled.length === 1) return enabled[0];
  const named = candidates.filter((candidate) => fold(candidate.title) === "ressources numeriques");
  if (named.length === 1) return named[0];
  console.error("Plusieurs bases portent une propriété « Domaine », aucune n'est la vitrine active :");
  for (const candidate of candidates) console.error(`- ${candidate.title} (${candidate.id})`);
  console.error("Relancer avec --base <id> pour choisir.");
  process.exit(1);
}

const database = drizzle(DATABASE_URL);

try {
  const rows = await database
    .select({ id: pages.id, title: pages.title, dbConfig: pages.dbConfig })
    .from(pages)
    .where(and(eq(pages.type, "database"), isNull(pages.trashedAt)));

  const candidates: Candidate[] = [];
  for (const row of rows) {
    const config = asConfig(row.dbConfig);
    const properties = asProperties(config);
    const domaine = domaineOf(properties);
    if (!domaine) continue;
    const vitrine = config.vitrine;
    const enabled = vitrine !== null && typeof vitrine === "object" && (vitrine as { enabled?: unknown }).enabled === true;
    candidates.push({ id: row.id, title: row.title, config, properties, domaine, enabled });
  }
  if (!candidates.length) {
    console.error("Aucune base ne porte une propriété « Domaine » en Sélection multiple.");
    process.exit(1);
  }

  const target = pickCandidate(candidates);
  const fixes = planLabelFixes(target.domaine.options ?? []);
  console.log(`Base « ${target.title} » (${target.id}) sur ${new URL(DATABASE_URL).pathname.slice(1)}, ${write ? "écriture" : "essai à blanc"}.`);
  console.log(describeFixes(fixes));

  if (!fixes.length) {
    console.log("Rien à corriger.");
    process.exit(0);
  }
  if (!write) {
    console.log("Rien n'a été écrit. Relancer avec --write pour appliquer.");
    process.exit(0);
  }

  const written = await database.transaction(async (tx) => {
    // Verrou de la base : aucune écriture concurrente ne doit changer son
    // schéma entre la lecture et l'écriture.
    const [locked] = await tx
      .select({ title: pages.title, dbConfig: pages.dbConfig })
      .from(pages)
      .where(eq(pages.id, target.id))
      .for("update");
    if (!locked) throw new Error("Base introuvable au moment d'écrire.");

    const config = asConfig(locked.dbConfig);
    const properties = asProperties(config);
    const domaine = domaineOf(properties);
    if (!domaine) throw new Error("La propriété « Domaine » a disparu entre la lecture et l'écriture.");

    const currentFixes = planLabelFixes(domaine.options ?? []);
    if (!currentFixes.length) return { fixes: currentFixes, entries: 0 };
    const fixedProperties = properties.map((prop) =>
      prop.id === domaine.id ? { ...prop, options: applyLabelFixes(prop.options ?? [], currentFixes) } : prop,
    );
    const nextConfig = { ...config, properties: fixedProperties };
    await tx.update(pages).set({ dbConfig: nextConfig }).where(eq(pages.id, target.id));

    const entries = await tx
      .select({ id: pages.id, propertyValues: pages.propertyValues, valuesText: pages.valuesText })
      .from(pages)
      .where(eq(pages.dbId, target.id));
    let changed = 0;
    for (const entry of entries) {
      const text = valuesToText(fixedProperties, asValues(entry.propertyValues));
      if (text === entry.valuesText) continue;
      // updated_at inchangé : c'est le libellé de la base qui a changé, pas
      // l'entrée.
      await tx
        .update(pages)
        .set({ valuesText: text, updatedAt: sql`${pages.updatedAt}` })
        .where(eq(pages.id, entry.id));
      changed++;
    }
    return { fixes: currentFixes, entries: changed };
  });

  console.log(`Écrit : ${written.fixes.length} étiquette(s) corrigée(s), ${written.entries} entrée(s) réindexée(s).`);

  const [after] = await database
    .select({ dbConfig: pages.dbConfig })
    .from(pages)
    .where(eq(pages.id, target.id));
  const remaining = planLabelFixes(domaineOf(asProperties(asConfig(after?.dbConfig)))?.options ?? []);
  if (remaining.length) {
    console.error("Attention : un second passage trouve encore du travail.");
    console.error(describeFixes(remaining));
    process.exit(1);
  }
  console.log("Second passage : rien à corriger.");
  process.exit(0);
} catch (error) {
  // Drizzle enveloppe l'erreur de PostgreSQL : la cause dit pourquoi.
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
  console.error(error instanceof Error ? `${error.message}${cause}` : error);
  process.exit(1);
}
