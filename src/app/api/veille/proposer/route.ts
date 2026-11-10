import { clientIp } from "@/lib/client_ip";
import { ensureInbox } from "@/lib/inbox";
import { appendBlocks } from "@/lib/pages";
import { sharedRateLimit } from "@/lib/rate_limit";
import { unfurl } from "@/lib/unfurl_fetch";
import { loadVitrine } from "@/lib/vitrine_query";
import {
  PROPOSAL_BODY_MAX,
  PROPOSAL_PER_HOUR,
  fakeAcceptance,
  isTrap,
  parseProposal,
  proposalBlocks,
  splitDuplicates,
  type ProposalResponse,
} from "@/lib/vitrine_proposal";

const limit = sharedRateLimit("veille_proposer", { limit: PROPOSAL_PER_HOUR, windowMs: 3_600_000 });

const NO_STORE = { "Cache-Control": "no-store" };

function refuse(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

// Public (proxy.ts ouvre /api/veille/*), sans session : 1 à 3 liens proposés
// par un visiteur, ajoutés en bas du Vide-cerveau (§11 ; SPECS, « Vitrine,
// proposition »). Ordre : piège (succès factice, rien de compté), limiteur
// (3/h par IP, tout envoi compté car chacun fait visiter des sites),
// lecture, doublons, visite des liens (garde DNS d'unfurl), écriture.
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > PROPOSAL_BODY_MAX) return refuse(413, { error: "Envoi trop long." });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > PROPOSAL_BODY_MAX) return refuse(413, { error: "Envoi trop long." });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, { error: "Envoi illisible." });
  }

  if (isTrap(body)) return Response.json(fakeAcceptance(body), { headers: NO_STORE });

  const ip = clientIp(request);
  const taken = limit.take(ip);
  if (!taken.ok) {
    const seconds = Math.max(1, Math.ceil(taken.retryAfter / 1000));
    return refuse(
      429,
      { error: `Tu as déjà fait ${PROPOSAL_PER_HOUR} envois cette heure-ci, merci ! Réessaie plus tard.`, retryAfter: seconds },
      { "Retry-After": String(seconds) },
    );
  }

  const proposal = parseProposal(body);
  if (!proposal.ok) return refuse(400, { error: proposal.error, invalid: proposal.invalid ?? [] });

  const vitrine = await loadVitrine();
  if (!vitrine) return refuse(404, { error: "Ce contenu n'est plus disponible." });

  const { fresh, duplicates } = splitDuplicates(proposal.links, vitrine.entries);
  const visits = await Promise.all(fresh.map(async (link) => ({ link, page: await unfurl(link.url) })));
  const accepted = visits.filter((visit) => visit.page.reached).map((visit) => ({ url: visit.link.url, title: visit.page.title }));
  const unreachable = visits.filter((visit) => !visit.page.reached).map((visit) => ({ url: visit.link.url }));

  if (accepted.length) {
    const inbox = await ensureInbox();
    const written = await appendBlocks(inbox.id, proposalBlocks(accepted, proposal.reason, proposal.name));
    if (!written.ok) return refuse(503, { error: "L'envoi a échoué, réessaie dans un instant." });
  }

  const response: ProposalResponse = { accepted, duplicates, unreachable, remaining: limit.remaining(ip) };
  return Response.json(response, { headers: NO_STORE });
}
