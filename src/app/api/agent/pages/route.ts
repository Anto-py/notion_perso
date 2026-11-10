// POST { parentId, title, markdown } : crée une page (sous parentId, à la
// racine sans lui) dont le corps est le Markdown converti. Réponse 201 { id,
// blocks, ignored, converted }. Journalisé.
// GET ?path= : page désignée par un chemin de titres (404 si aucune, 409 et
// ses candidats si plusieurs). GET ?parent= : enfants d'une page, entrées
// d'une base ; sans paramètre, racines de l'arbre. SPECS.md, « Accès agent ».
import { fail, optionalId, readJson } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { logAgentAction } from "@/lib/agent_log";
import { listChildren, resolveAgentPath } from "@/lib/agent_read";
import { requestOrigin } from "@/lib/agent_rules";
import { convertMarkdown, readMarkdown, readTitle } from "@/lib/agent_write";
import { createPage, getPage } from "@/lib/pages";

export async function GET(request: Request) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const params = new URL(request.url).searchParams;

  const path = params.get("path");
  if (path !== null) {
    const result = await resolveAgentPath(path);
    if (result.kind === "none") return fail(404, `Aucune page pour « ${path.trim()} »`);
    if (result.kind === "ambiguous") {
      return Response.json({ error: "Chemin ambigu", candidates: result.candidates }, { status: 409 });
    }
    return Response.json({ id: result.id });
  }

  const parent = params.get("parent")?.trim() || null;
  const children = await listChildren(parent);
  if (!children) return fail(404, "Page introuvable");
  return Response.json({ children });
}

export async function POST(request: Request) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const body = await readJson(request);
  if (!body) return fail(400, "Corps JSON attendu");
  const parentId = optionalId(body.parentId);
  if (parentId === undefined) return fail(400, "parentId invalide");
  const title = readTitle(body.title ?? "");
  if ("error" in title) return fail(400, title.error);
  const markdown = readMarkdown(body.markdown ?? "");
  if ("error" in markdown) return fail(400, markdown.error);
  if (parentId) {
    const parent = await getPage(parentId);
    if (!parent || parent.trashedAt) return fail(404, "Page parente introuvable");
  }

  const conversion = await convertMarkdown(markdown.value, requestOrigin(request));
  const outcome = await createPage(parentId, "page", { title: title.value, body: conversion.blocks });
  if (!outcome.ok || !outcome.id) return fail(outcome.ok ? 500 : outcome.status, outcome.ok ? "Création impossible" : outcome.error);
  await logAgentAction(agent, "création", outcome.id, { title: title.value, blocks: conversion.blocks.length });
  return Response.json(
    { id: outcome.id, blocks: conversion.blocks.length, ignored: conversion.ignored, converted: conversion.converted },
    { status: 201 },
  );
}
