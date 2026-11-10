// POST { title?, values, markdown? } : crée une entrée dans une base. Les
// propriétés se désignent par leur nom (sans accents ni casse), une option
// inconnue est créée, une relation se donne par titres. Le corps Markdown est
// converti par le profil agent et écrit avec l'entrée, dans la même
// transaction. Refus entier dès qu'une valeur ne passe pas. Journalisé.
// SPECS.md, « Accès agent », palier d.
import { fail, readJson } from "@/lib/api";
import { requireAgent } from "@/lib/agent_auth";
import { logAgentAction } from "@/lib/agent_log";
import { requestOrigin } from "@/lib/agent_rules";
import { readAgentValues, resolveAgentValues } from "@/lib/agent_values";
import { convertMarkdown, readMarkdown, readTitle, resolveRelationAnswers } from "@/lib/agent_write";
import { configOf, createEntry } from "@/lib/databases";
import { getPage } from "@/lib/pages";

export async function POST(request: Request, ctx: RouteContext<"/api/agent/databases/[id]/entries">) {
  const agent = await requireAgent(request);
  if (agent instanceof Response) return agent;
  const { id } = await ctx.params;
  const base = await getPage(id);
  if (!base || base.trashedAt || base.type !== "database") return fail(404, "Base introuvable");

  const body = await readJson(request);
  if (!body) return fail(400, "Corps JSON attendu");
  const values = readAgentValues(body.values);
  if (typeof values === "string") return fail(400, values);
  const title = readTitle(body.title ?? "");
  if ("error" in title) return fail(400, title.error);
  const markdown = readMarkdown(body.markdown ?? "");
  if ("error" in markdown) return fail(400, markdown.error);

  const properties = configOf(base).properties;
  const answers = await resolveRelationAnswers(properties, values);
  const resolved = resolveAgentValues(properties, values, answers);
  if (!resolved.ok) return fail(400, resolved.error);

  const conversion = await convertMarkdown(markdown.value, requestOrigin(request));
  const outcome = await createEntry(id, resolved.values, title.value, {
    properties: resolved.created.length ? resolved.properties : undefined,
    body: conversion.blocks,
  });
  if (!outcome.ok || !outcome.id) {
    return fail(outcome.ok ? 500 : outcome.status, outcome.ok ? "Création impossible" : outcome.error);
  }
  await logAgentAction(agent, "création", outcome.id, {
    title: title.value,
    base: base.title,
    blocks: conversion.blocks.length,
    ...(resolved.created.length ? { options: resolved.created } : {}),
  });
  return Response.json(
    {
      id: outcome.id,
      blocks: conversion.blocks.length,
      created: resolved.created,
      ignored: conversion.ignored,
      converted: conversion.converted,
    },
    { status: 201 },
  );
}
