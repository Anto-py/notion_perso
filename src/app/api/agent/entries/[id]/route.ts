// PATCH { values } : change les valeurs d'une entrée existante, par nom de
// propriété. Le corps ne se remplace pas (np ajouter sur l'entrée) ; le schéma
// ne se modifie pas, sauf l'option inconnue d'une Sélection, créée comme dans
// l'éditeur. Refus entier dès qu'une valeur ne passe pas. Journalisé.
// SPECS.md, « Accès agent », palier d.
import { fail, readJson } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { readAgentValues, resolveAgentValues } from "@/lib/agent_values";
import { resolveRelationAnswers } from "@/lib/agent_write";
import { configOf, updateEntry } from "@/lib/databases";
import { getPage } from "@/lib/pages";

const PATCH_FIELDS = new Set(["values"]);

export async function PATCH(request: Request, ctx: RouteContext<"/api/agent/entries/[id]">) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const { id } = await ctx.params;
  const entry = await getPage(id);
  if (!entry || entry.trashedAt || entry.type !== "entry" || !entry.dbId) return fail(404, "Entrée introuvable");

  const body = await readJson(request);
  if (!body) return fail(400, "Corps JSON attendu");
  const refused = Object.keys(body).filter((key) => !PATCH_FIELDS.has(key));
  if (refused.length) return fail(400, `Champ refusé : ${refused.join(", ")}`);
  const values = readAgentValues(body.values);
  if (typeof values === "string") return fail(400, values);
  if (!Object.keys(values).length) return fail(400, "Aucune valeur à modifier");

  const base = await getPage(entry.dbId);
  if (!base || base.trashedAt || base.type !== "database") return fail(404, "Base introuvable");
  const properties = configOf(base).properties;
  const answers = await resolveRelationAnswers(properties, values);
  const resolved = resolveAgentValues(properties, values, answers);
  if (!resolved.ok) return fail(400, resolved.error);

  const outcome = await updateEntry(id, {
    values: resolved.values,
    properties: resolved.created.length ? resolved.properties : undefined,
  });
  if (!outcome.ok) return fail(outcome.status, outcome.error);
  return Response.json({ ok: true, created: resolved.created });
}
