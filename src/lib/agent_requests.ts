// Demandes de l'agent soumises à validation humaine (SPECS.md, « Accès
// agent », palier f) : publication, purge, et déplacement qui change ce que
// le public lit (target_id : la nouvelle mère, null pour la racine). Une
// demande ouverte vit jusqu'à « Valider » ou « Refuser » dans Réglages ›
// Agent. Le geste lui-même est exécuté par la route sous session, jamais par
// l'agent.
import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { agentRequests, agentTokens, pages } from "@/db/schema";
import type { Agent } from "./agent_auth";
import { isRequestAction, type RequestAction, type RequestDecision } from "./agent_rules";
import { newId } from "./ids";

export type AgentRequest = {
  id: string;
  tokenId: string;
  tokenName: string | null;
  model: string | null;
  action: RequestAction;
  pageId: string;
  pageTitle: string | null;
  targetId: string | null;
  targetTitle: string | null;
  createdAt: Date;
};

const targets = alias(pages, "target");

const FIELDS = {
  id: agentRequests.id,
  tokenId: agentRequests.tokenId,
  tokenName: agentTokens.name,
  model: agentRequests.model,
  action: agentRequests.action,
  pageId: agentRequests.pageId,
  pageTitle: pages.title,
  targetId: agentRequests.targetId,
  targetTitle: targets.title,
  createdAt: agentRequests.createdAt,
};

function toRequest(row: {
  id: string;
  tokenId: string;
  tokenName: string | null;
  model: string | null;
  action: string;
  pageId: string;
  pageTitle: string | null;
  targetId: string | null;
  targetTitle: string | null;
  createdAt: Date;
}): AgentRequest | null {
  if (!isRequestAction(row.action)) return null;
  return { ...row, action: row.action };
}

// Dépose une demande. Une demande identique encore ouverte (même jeton, même
// action, même page, même destination) est réutilisée : relancer `np publier`
// ne crée pas de doublon dans Réglages. targetId : la destination d'un
// déplacement, null pour la racine comme pour les autres actions.
export async function requestAgentAction(
  agent: Agent,
  action: RequestAction,
  pageId: string,
  targetId: string | null = null,
): Promise<{ id: string; reused: boolean }> {
  const [open] = await db
    .select({ id: agentRequests.id })
    .from(agentRequests)
    .where(
      and(
        eq(agentRequests.tokenId, agent.tokenId),
        eq(agentRequests.action, action),
        eq(agentRequests.pageId, pageId),
        targetId === null ? isNull(agentRequests.targetId) : eq(agentRequests.targetId, targetId),
        isNull(agentRequests.decidedAt),
      ),
    )
    .limit(1);
  if (open) return { id: open.id, reused: true };
  const id = newId("ar");
  await db.insert(agentRequests).values({ id, tokenId: agent.tokenId, model: agent.model, action, pageId, targetId });
  return { id, reused: false };
}

// Demandes ouvertes, la plus ancienne d'abord.
export async function listAgentRequests(): Promise<AgentRequest[]> {
  const rows = await db
    .select(FIELDS)
    .from(agentRequests)
    .leftJoin(agentTokens, eq(agentTokens.id, agentRequests.tokenId))
    .leftJoin(pages, eq(pages.id, agentRequests.pageId))
    .leftJoin(targets, eq(targets.id, agentRequests.targetId))
    .where(isNull(agentRequests.decidedAt))
    .orderBy(asc(agentRequests.createdAt), asc(agentRequests.id));
  return rows.flatMap((row) => {
    const request = toRequest(row);
    return request ? [request] : [];
  });
}

export async function openAgentRequest(id: string): Promise<AgentRequest | null> {
  const [row] = await db
    .select(FIELDS)
    .from(agentRequests)
    .leftJoin(agentTokens, eq(agentTokens.id, agentRequests.tokenId))
    .leftJoin(pages, eq(pages.id, agentRequests.pageId))
    .leftJoin(targets, eq(targets.id, agentRequests.targetId))
    .where(and(eq(agentRequests.id, id), isNull(agentRequests.decidedAt)))
    .limit(1);
  return row ? toRequest(row) : null;
}

// Ferme la demande. false si elle l'était déjà : deux clics ne décident
// qu'une fois.
export async function closeAgentRequest(id: string, decision: RequestDecision): Promise<boolean> {
  const rows = await db
    .update(agentRequests)
    .set({ decidedAt: new Date(), decision })
    .where(and(eq(agentRequests.id, id), isNull(agentRequests.decidedAt)))
    .returning({ id: agentRequests.id });
  return rows.length > 0;
}
