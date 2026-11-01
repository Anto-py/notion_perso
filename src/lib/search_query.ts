// Recherche plein-texte dans les titres, corps et valeurs de propriétés.
//
// Chaque mot doit se retrouver dans la page, de l'une de deux façons :
// - par sa racine, comme début de racine (search_vector, index GIN) :
//   « evaluations » trouve « évaluation », « chevaux » trouve « cheval » ;
// - comme début de mot du texte sans accents. Sans ce second chemin, les
//   résultats disparaîtraient pendant la frappe : « evaluat » n'est le début
//   d'aucune racine (« evaluation » se racine en « evalu »). Ce balayage lit
//   chaque ligne, coût jugé négligeable pour une base personnelle.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { HIT_END, HIT_START, searchTerms, type SearchHit, type SearchKind } from "./search";

const LIMIT = 20;

// fr_unaccent (migration 0003) relit le texte d'origine en ôtant les accents
// avant de raciner : « Évaluation » est surligné pour « evaluation ».
const HEADLINE_OPTIONS = `StartSel=${HIT_START}, StopSel=${HIT_END}, MaxWords=24, MinWords=10, MaxFragments=1, FragmentDelimiter=" … "`;

// executor : la base vive par défaut, la copie d'une sauvegarde quand
// l'écran de sauvegarde cherche (lib/backup_read.ts).
export async function searchPages(query: string, executor: Pick<typeof db, "execute"> = db): Promise<SearchHit[]> {
  const terms = searchTerms(query);
  if (!terms.length) return [];

  const list = sql.join(
    terms.map((term) => sql`${term}`),
    sql`, `,
  );
  // Requête combinée pour le classement et l'extrait. Les mots ne contiennent
  // que lettres et chiffres (searchTerms) : aucune syntaxe ne peut s'y glisser.
  const combined = terms.map((term) => `${term}:*`).join(" | ");

  // MATERIALIZED : to_tsquery est évalué une fois par mot, et non une fois par
  // ligne (un mot vide comme « de » émettrait sinon un NOTICE à chaque page).
  const result = await executor.execute<{
    id: string;
    type: SearchKind;
    title: string;
    icon: string | null;
    is_inbox: boolean;
    excerpt: string;
  }>(sql`
    WITH terms AS MATERIALIZED (
      SELECT f_unaccent(t) AS t, to_tsquery('french', f_unaccent(t) || ':*') AS q
      FROM unnest(ARRAY[${list}]::text[]) AS t
    ), query AS MATERIALIZED (
      SELECT to_tsquery('french', f_unaccent(${combined})) AS q
    )
    SELECT p.id, p.type, p.title, p.icon, p.is_inbox,
      ts_headline('fr_unaccent', p.body_text || E'\n' || p.values_text, query.q, ${HEADLINE_OPTIONS}) AS excerpt
    FROM pages p, query
    WHERE p.trashed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM terms
        WHERE NOT (
          p.search_vector @@ terms.q
          OR lower(f_unaccent(p.title || ' ' || p.body_text || ' ' || p.values_text)) ~ ('\\m' || terms.t)
        )
      )
    ORDER BY
      (SELECT count(*) FROM terms WHERE lower(f_unaccent(p.title)) ~ ('\\m' || terms.t)) DESC,
      ts_rank(p.search_vector, query.q) DESC,
      p.updated_at DESC
    LIMIT ${LIMIT}
  `);

  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    icon: row.icon,
    isInbox: row.is_inbox,
    excerpt: row.excerpt,
  }));
}
