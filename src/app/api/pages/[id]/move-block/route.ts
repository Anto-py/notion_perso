import { fail, optionalId, readJson, requirePage } from "@/lib/api";
import { isBlockList } from "@/lib/block_move";
import { moveBlock } from "@/lib/block_move_query";

// Un bloc de l'éditeur, enfants compris, pèse rarement plus de quelques Ko ;
// ce plafond écarte seulement un envoi absurde.
const MAX_BYTES = 2_000_000;

// POST { blocks: [bloc], targetId, confirmed? } : ajoute le bloc au bas de la page cible,
// ou crée une page à la racine si targetId est null, et fait changer de mère
// les sous-pages qu'il emporte, en une transaction. Ne touche jamais au corps
// de la page source : l'éditeur retire le bloc lui-même après la réponse.
// Réponse { destination, created, title, moved } (lib/block_move_query.ts). Si le
// déplacement change ce que le public peut lire (lib/block_move_share.ts), 409
// { error, warnings } sans rien écrire, tant que confirmed n'est pas true.
export async function POST(request: Request, ctx: RouteContext<"/api/pages/[id]/move-block">) {
  const { id } = await ctx.params;
  const found = await requirePage(id, "write");
  if (found instanceof Response) return found;
  // Seule une page ou une entrée a un corps d'où tirer un bloc.
  if (found.page.type === "folder" || found.page.type === "database") return fail(400, "Un dossier ou une base n'a pas de corps.");

  const body = await readJson(request);
  if (!body || !("targetId" in body)) return fail(400, "targetId attendu (null pour la racine)");
  const targetId = optionalId(body.targetId);
  if (targetId === undefined) return fail(400, "targetId invalide");
  if (!isBlockList(body.blocks) || JSON.stringify(body.blocks).length > MAX_BYTES) return fail(400, "Bloc invalide");
  if (targetId) {
    const target = await requirePage(targetId, "write");
    if (target instanceof Response) return target;
  }

  const result = await moveBlock(id, targetId, body.blocks, { confirmed: body.confirmed === true });
  if (!result.ok && result.warnings) return Response.json({ error: result.error, warnings: result.warnings }, { status: 409 });
  if (!result.ok) return fail(result.status, result.error);
  return Response.json(result);
}
