// POST { markdown } : ajoute le Markdown converti au bas du corps, sans rien
// remplacer (appendBlocks, partagé avec le Vide-cerveau). Refusé sur un
// dossier, une base, une page en corbeille. Réponse { id, blocks, ignored,
// converted }. Journalisé.
import { fail, readJson } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { requestOrigin } from "@/lib/agent_rules";
import { convertMarkdown, readMarkdown } from "@/lib/agent_write";
import { appendBlocks, getPage } from "@/lib/pages";

export async function POST(request: Request, ctx: RouteContext<"/api/agent/pages/[id]/append">) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const { id } = await ctx.params;
  const body = await readJson(request);
  const markdown = readMarkdown(body?.markdown);
  if ("error" in markdown) return fail(400, markdown.error);
  const page = await getPage(id);
  if (!page) return fail(404, "Page introuvable");

  const conversion = await convertMarkdown(markdown.value, requestOrigin(request));
  if (!conversion.blocks.length) return fail(400, "Rien à ajouter : le Markdown ne donne aucun bloc.");
  const outcome = await appendBlocks(id, conversion.blocks);
  if (!outcome.ok) return fail(outcome.status, outcome.error);
  return Response.json({ id, blocks: conversion.blocks.length, ignored: conversion.ignored, converted: conversion.converted });
}
