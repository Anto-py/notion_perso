// Carte d'une ressource de la vitrine (BRAINSTORMING de la vitrine, §5). Sans
// hook : rendue par le serveur comme par le navigateur. Logo et ouverture de
// la fiche viendront ensuite ; seuls les champs de VitrineEntry y entrent.
import type { VitrineEntry } from "@/lib/vitrine";

const TAGS_SHOWN = 3;

export function VitrineCard({ entry }: { entry: VitrineEntry }) {
  const tags = entry.domaines.slice(0, TAGS_SHOWN);
  const more = entry.domaines.length - tags.length;
  const meta = [entry.niveau, ...entry.prix].filter(Boolean).join(" · ");
  return (
    <article className="vitrine-card">
      <h3 className="vitrine-card-title">
        {entry.title || "Sans titre"}
        {entry.coeur ? (
          <span className="vitrine-heart" role="img" aria-label="Coup de cœur">
            ★
          </span>
        ) : null}
      </h3>
      {entry.description ? <p className="vitrine-card-desc">{entry.description}</p> : null}
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
