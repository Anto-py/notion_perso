// Proposition d'une ressource depuis la vitrine (§11), partie pure : servie
// au navigateur (contrôle au fil de la frappe) comme au serveur, qui refait
// tout. Lecture de l'envoi, doublons, blocs écrits au Vide-cerveau. La route
// (api/veille/proposer) ajoute le limiteur, la visite des liens et l'écriture.
import { mentionBlock, noteBlock } from "./capture";
import { hostOf, parseSite, siteKey } from "./vitrine";

export const PROPOSAL_LINKS_MAX = 3;
export const PROPOSAL_URL_MAX = 2048;
export const PROPOSAL_REASON_MAX = 300;
export const PROPOSAL_NAME_MAX = 40;
export const PROPOSAL_BODY_MAX = 8 * 1024;
export const PROPOSAL_PER_HOUR = 3;

const MALFORMED = "Adresse mal formée, par exemple https://exemple.org";

export type ProposedLink = { url: string; key: string };
type Keyed = { slug: string; title: string; siteKey: string | null };

export type ProposalResponse = {
  accepted: { url: string; title: string }[];
  duplicates: { url: string; slug: string; title: string }[];
  unreachable: { url: string }[];
  remaining: number;
};

// Une adresse proposée : http(s), un nom de domaine à point, schéma ajouté
// s'il manque (parseSite, la règle des Site Web de la base).
export function checkLink(raw: string): ({ ok: true } & ProposedLink) | { ok: false; error: string } {
  const text = raw.trim();
  if (text.length > PROPOSAL_URL_MAX) return { ok: false, error: "Adresse trop longue." };
  const url = parseSite(text);
  const key = url ? siteKey(url.href) : null;
  if (!url || !key) return { ok: false, error: MALFORMED };
  return { ok: true, url: url.href, key };
}

// Doublon : même clé, ou racine sans chemin qui couvre son hôte et ses
// sous-domaines (« mindmup.com » couvre app.mindmup.com, « quizlet.com »
// couvre quizlet.com/teachers). Un chemin ne couvre que lui-même.
export function findDuplicate<T extends Keyed>(key: string, entries: readonly T[]): T | null {
  const exact = entries.find((entry) => entry.siteKey === key);
  if (exact || key.includes("/")) return exact ?? null;
  return (
    entries.find((entry) => {
      const host = entry.siteKey?.split("/")[0];
      return host !== undefined && (host === key || host.endsWith(`.${key}`));
    }) ?? null
  );
}

export type LinkStatus =
  | { kind: "empty" }
  | { kind: "invalid"; error: string }
  | { kind: "duplicate"; slug: string; title: string }
  | { kind: "repeat" }
  | ({ kind: "ok" } & ProposedLink);

// État de chaque champ « Lien » du formulaire, dans l'ordre : un même site
// saisi deux fois n'est compté qu'au premier champ.
export function linkStatuses(values: readonly string[], entries: readonly Keyed[]): LinkStatus[] {
  const seen = new Set<string>();
  return values.map((value) => {
    if (!value.trim()) return { kind: "empty" };
    const link = checkLink(value);
    if (!link.ok) return { kind: "invalid", error: link.error };
    if (seen.has(link.key)) return { kind: "repeat" };
    seen.add(link.key);
    const duplicate = findDuplicate(link.key, entries);
    if (duplicate) return { kind: "duplicate", slug: duplicate.slug, title: duplicate.title };
    return { kind: "ok", url: link.url, key: link.key };
  });
}

function record(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

// Champ invisible que seul un robot remplit.
export function isTrap(body: unknown): boolean {
  const website = record(body)?.website;
  return typeof website === "string" && website.trim() !== "";
}

// Texte libre : retours à la ligne et tabulations deviennent des espaces, les
// autres caractères de contrôle disparaissent, puis coupe à la borne.
function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const text = raw
    .replace(/[\t\n\r]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
  return Array.from(text).slice(0, max).join("").trim();
}

export type ParsedProposal =
  | { ok: true; links: ProposedLink[]; reason: string; name: string }
  | { ok: false; error: string; invalid?: { url: string; error: string }[] };

export function parseProposal(body: unknown): ParsedProposal {
  const data = record(body);
  if (!data || !Array.isArray(data.links)) return { ok: false, error: "Envoi illisible." };
  // Un lien qui n'est pas du texte est mal formé : String(42) passerait pour
  // l'adresse IP 0.0.0.42.
  const raws = data.links
    .map((value) => (typeof value === "string" ? { text: value.trim(), typed: true } : { text: String(value), typed: false }))
    .filter((raw) => raw.text);
  if (!raws.length) return { ok: false, error: "Indique au moins un lien." };
  if (raws.length > PROPOSAL_LINKS_MAX) return { ok: false, error: `${PROPOSAL_LINKS_MAX} liens au plus.` };

  const links: ProposedLink[] = [];
  const invalid: { url: string; error: string }[] = [];
  for (const raw of raws) {
    const link = raw.typed ? checkLink(raw.text) : ({ ok: false, error: MALFORMED } as const);
    if (!link.ok) invalid.push({ url: raw.text, error: link.error });
    else if (!links.some((known) => known.key === link.key)) links.push({ url: link.url, key: link.key });
  }
  if (invalid.length) return { ok: false, error: "Certains liens sont mal formés.", invalid };
  return { ok: true, links, reason: cleanText(data.reason, PROPOSAL_REASON_MAX), name: cleanText(data.name, PROPOSAL_NAME_MAX) };
}

export function splitDuplicates(
  links: readonly ProposedLink[],
  entries: readonly Keyed[],
): { fresh: ProposedLink[]; duplicates: ProposalResponse["duplicates"] } {
  const fresh: ProposedLink[] = [];
  const duplicates: ProposalResponse["duplicates"] = [];
  for (const link of links) {
    const entry = findDuplicate(link.key, entries);
    if (entry) duplicates.push({ url: link.url, slug: entry.slug, title: entry.title });
    else fresh.push(link);
  }
  return { fresh, duplicates };
}

// Ajout au Vide-cerveau : une mention par lien, puis « Proposé via la
// vitrine · Julie · « … » », prénom et raison omis s'ils sont vides.
export function proposalBlocks(accepted: readonly { url: string; title: string }[], reason: string, name: string): Record<string, unknown>[] {
  const credit = ["Proposé via la vitrine", name, reason ? `« ${reason} »` : ""].filter(Boolean).join(" · ");
  return [...accepted.map((link) => mentionBlock(link.url, link.title)), noteBlock(credit)];
}

// Réponse au robot qui a rempli le piège : un succès plausible, sans visite
// ni écriture.
export function fakeAcceptance(body: unknown): ProposalResponse {
  const links = record(body)?.links;
  const accepted: ProposalResponse["accepted"] = [];
  for (const raw of Array.isArray(links) ? links.slice(0, PROPOSAL_LINKS_MAX) : []) {
    const link = typeof raw === "string" ? checkLink(raw) : null;
    if (link?.ok) accepted.push({ url: link.url, title: hostOf(new URL(link.url)) });
  }
  return { accepted, duplicates: [], unreachable: [], remaining: PROPOSAL_PER_HOUR - 1 };
}
