// PATCH { title?, icon?, parentId? } : renomme, change l'icône, déplace (null :
// racine). Tout autre champ est refusé, `body` d'abord : l'agent n'ajoute
// qu'en bas (append), il ne remplace jamais un corps. Un déplacement qui
// change ce que le public lit dépose une demande (202 { pending, warnings }),
// exécutée par « Valider » dans Réglages › Agent.
// GET ?format=md : une page en Markdown (SPECS.md, « Accès agent », « Blocs →
// Markdown »). Le seul format servi ; une page en corbeille se lit encore,
// marquée `trashed`.
import { fail, optionalId, readJson } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { readTitle } from "@/lib/agent_write";
import { isLibraryFile } from "@/lib/icon_library";
import { checkIconValue } from "@/lib/icons";
import { requestAgentAction } from "@/lib/agent_requests";
import { pageMoveWarningsFor } from "@/lib/page_move_query";
import { getPage, movePage, updatePage, type PagePatch } from "@/lib/pages";
import { forgetPublicReach } from "@/lib/publication_query";
import { readPageMarkdown } from "@/lib/agent_read";
import { requestOrigin } from "@/lib/agent_rules";

export async function GET(request: Request, ctx: RouteContext<"/api/agent/pages/[id]">) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const format = new URL(request.url).searchParams.get("format") ?? "md";
  if (format !== "md") return fail(400, "Format inconnu (seul « md » est servi)");
  const { id } = await ctx.params;
  const origin = requestOrigin(request);
  const page = await readPageMarkdown(id, origin);
  if (!page) return fail(404, "Page introuvable");
  return Response.json(page);
}

const PATCH_FIELDS = new Set(["title", "icon", "parentId"]);

export async function PATCH(request: Request, ctx: RouteContext<"/api/agent/pages/[id]">) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return fail(400, "Corps JSON attendu");
  if ("body" in body) return fail(400, "Le corps ne se remplace pas : ajoutez en bas (np ajouter).");
  const refused = Object.keys(body).filter((key) => !PATCH_FIELDS.has(key));
  if (refused.length) return fail(400, `Champ refusé : ${refused.join(", ")}`);
  if (!Object.keys(body).length) return fail(400, "Rien à modifier (title, icon ou parentId)");

  const page = await getPage(id);
  if (!page || page.trashedAt) return fail(404, "Page introuvable");
  if (page.isBasesRoot && ("title" in body || "icon" in body)) return fail(400, "« Bases de données » garde son nom et son icône.");

  const patch: PagePatch = {};
  if ("title" in body) {
    const title = readTitle(body.title);
    if ("error" in title) return fail(400, title.error);
    patch.title = title.value;
  }
  if ("icon" in body) {
    const icon = checkIconValue(body.icon);
    if (!icon.ok) return fail(400, "Icône invalide (un emoji, ou null pour la retirer)");
    if (icon.filename && !(await isLibraryFile(icon.filename))) return fail(400, "Image absente de la bibliothèque");
    patch.icon = icon.value;
  }
  // Le déplacement d'abord : c'est lui qui peut être refusé (boucle, base sous
  // une page), et un refus ne doit rien laisser d'écrit.
  if ("parentId" in body) {
    if (page.type === "entry") return fail(400, "Une entrée vit dans sa base.");
    const parentId = optionalId(body.parentId);
    if (parentId === undefined) return fail(400, "parentId invalide");
    const changesParent = parentId !== page.parentId;
    // Un déplacement qui change ce que le public lit vaut publication ou
    // dépublication : il attend la validation d'Antonin, comme np publier
    // (202, rien d'écrit). Il se demande seul, pour que rien ne s'écrive à
    // moitié.
    const warnings = changesParent ? await pageMoveWarningsFor(id, parentId) : [];
    if (warnings.length) {
      if (Object.keys(patch).length) {
        return fail(409, "Ce déplacement change ce que le public lit et attend une validation : demandez-le seul, sans title ni icon.");
      }
      const check = await movePage(id, parentId, undefined, { dryRun: true });
      if (!check.ok) return fail(check.status, check.error);
      const demand = await requestAgentAction(agent, "move", id, parentId);
      return Response.json(
        { ok: true, pending: true, request: demand.id, action: "move", page: { id, title: page.title }, parentId, warnings },
        { status: 202 },
      );
    }
    const moved = await movePage(id, parentId);
    if (!moved.ok) return fail(moved.status, moved.error);
    if (changesParent) forgetPublicReach();
  }
  if (Object.keys(patch).length) {
    const saved = await updatePage(id, patch);
    if (!saved.ok) return fail(saved.status, saved.error);
  }
  return Response.json({ ok: true });
}
