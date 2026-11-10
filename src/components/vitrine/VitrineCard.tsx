// Carte d'une ressource de la vitrine (BRAINSTORMING de la vitrine, §5). Sans
// hook : rendue par le serveur comme par le navigateur. Dans les résultats
// d'une recherche, le terme est surligné dans le titre et la description, et
// un passage trouvé dans le corps vient en extrait d'une ligne (§2). Logo et
// ouverture de la fiche viendront ensuite ; seuls les champs de VitrineEntry y
// entrent.
import { parseHeadline, type Segment } from "@/lib/search";
import { highlightTerms, type VitrineEntry } from "@/lib/vitrine";

const TAGS_SHOWN = 3;

// Recherche affichée : requête et extraits du corps, par slug.
export type CardHighlight = { query: string; snippets: ReadonlyMap<string, string> };

function Marked({ segments }: { segments: readonly Segment[] }) {
  return segments.map((segment, index) => (segment.hit ? <mark key={index}>{segment.text}</mark> : segment.text));
}

function Text({ text, query }: { text: string; query: string | null }) {
  return query ? <Marked segments={highlightTerms(text, query)} /> : text;
}

export function VitrineCard({ entry, highlight }: { entry: VitrineEntry; highlight?: CardHighlight }) {
  const tags = entry.domaines.slice(0, TAGS_SHOWN);
  const more = entry.domaines.length - tags.length;
  const meta = [entry.niveau, ...entry.prix].filter(Boolean).join(" · ");
  const query = highlight?.query ?? null;
  const snippet = highlight?.snippets.get(entry.slug);
  return (
    <article className="vitrine-card">
      <h3 className="vitrine-card-title">
        <Text text={entry.title || "Sans titre"} query={query} />
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
