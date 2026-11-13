// Retrouver la page d'un bloc par son identifiant (étape 21, palier d). Un lien
// `/page/<id>#<bloc>` copié avant un déplacement vise l'ancienne page ; le bloc
// garde son identifiant en voyageant, on le cherche donc dans le corps des pages
// vivantes. Jouée seulement quand la page visée ne porte plus le bloc.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pickRelocated } from "./block_link";

// Deux pages portent le même bloc après un déplacement interrompu (le doublon
// voulu par BlockMove) : quelques lignes suffisent à départager. Pas d'index sur
// `body` ; un balayage de `pages` convient à une recherche aussi rare.
const MAX_ROWS = 20;

export async function locateBlock(blockId: string, notPageId: string): Promise<string | null> {
  const result = await db.execute<{ id: string; updated_at: Date | string }>(sql`
    SELECT id, updated_at FROM pages
    WHERE trashed_at IS NULL
      AND id <> ${notPageId}
      AND jsonb_path_exists(body, '$.** ? (@.id == $block)', jsonb_build_object('block', ${blockId}::text))
    LIMIT ${MAX_ROWS}`);
  return pickRelocated(
    result.rows.map((row) => ({ id: row.id, updatedAt: row.updated_at })),
    notPageId,
  );
}
