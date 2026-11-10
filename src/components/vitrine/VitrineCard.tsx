// Carte d'une ressource de la vitrine (BRAINSTORMING de la vitrine, §5). Sans
// hook : rendue par le serveur comme par le navigateur. Dans les résultats
// d'une recherche, le terme est surligné dans le titre et la description, et
// un passage trouvé dans le corps vient en extrait d'une ligne (§2). Le logo
// (VitrineLogo, seul îlot client) précède le titre ; seuls les champs de
// VitrineEntry y entrent.
//
// Toute la carte ouvre la fiche (§5) : seul le titre est un lien, étiré sur
// la carte par le CSS (::after). Sans JavaScript, il mène à l'adresse de la
// fiche ; avec, Vitrine intercepte le clic (data-fiche, data-row : rangée
// d'origine, pour les voisines et le retour du focus).
import { parseHeadline, type Segment } from "@/lib/search";
import { ficheHref, highlightTerms, type VitrineEntry } from "@/lib/vitrine";
import type { SheetRow } from "@/lib/vitrine_state";
import { VitrineLogo } from "./VitrineLogo";

const TAGS_SHOWN = 3;

// Recherche affichée : requête et extraits du corps, par slug.
export type CardHighlight = { query: string; snippets: ReadonlyMap<string, string> };

function Marked({ segments }: { segments: readonly Segment[] }) {
  return segments.map((segment, index) => (segment.hit ? <mark key={index}>{segment.text}</mark> : segment.text));
}

function Text({ text, query }: { text: string; query: string | null }) {
  return query ? <Marked segments={highlightTerms(text, query)} /> : text;
}

export function VitrineCard({ entry, row, highlight }: { entry: VitrineEntry; row: SheetRow; highlight?: CardHighlight }) {
  const tags = entry.domaines.slice(0, TAGS_SHOWN);
  const more = entry.domaines.length - tags.length;
  const meta = [entry.niveau, ...entry.prix].filter(Boolean).join(" · ");
  const query = highlight?.query ?? null;
  const snippet = highlight?.snippets.get(entry.slug);
  return (
    <article className="vitrine-card">
      <h3 className="vitrine-card-title">
        <VitrineLogo entry={entry} />
        <a className="vitrine-card-link" href={ficheHref(entry.slug)} data-fiche={entry.slug} data-row={row}>
          <Text text={entry.title || "Sans titre"} query={query} />
        </a>
        {entry.coeur ? (
          <span className="vitrine-heart" role="img" aria-label="Coup de cœur">
            ★
          </span>
        ) : null}
      </h3>
      {entry.description ? (
        <p className="vitrine-card-desc">
          <Text text={entry.description} query={query} />
        </p>
      ) : null}
      {snippet ? (
        <p className="vitrine-card-snippet">
          <Marked segments={parseHeadline(snippet)} />
        </p>
      ) : null}
      {tags.length ? (
        <ul className="vitrine-tags">
          {tags.map((label) => (
            <li key={label}>{label}</li>
          ))}
          {more > 0 ? <li className="vitrine-tags-more">+{more}</li> : null}
        </ul>
      ) : null}
      {meta || entry.nouveau ? (
        <p className="vitrine-card-meta">
          {meta}
          {entry.nouveau ? <span className="vitrine-new">Nouveau</span> : null}
        </p>
      ) : null}
    </article>
  );
}
