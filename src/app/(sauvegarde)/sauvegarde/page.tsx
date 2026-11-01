import Link from "next/link";
import { Suspense } from "react";
import { PageLabel } from "@/components/PageIcon";
import { backupSearch } from "@/lib/backup_read";
import { parseHeadline, type SearchHit } from "@/lib/search";

// Accueil de l'écran de sauvegarde, et résultats de sa recherche (formulaire
// GET de la coquille). Rien ne s'y modifie : les liens mènent à la copie.
export default function BackupHome({ searchParams }: PageProps<"/sauvegarde">) {
  return (
    <Suspense fallback={<p className="page-loading">Chargement…</p>}>
      <BackupHomeData searchParams={searchParams} />
    </Suspense>
  );
}

async function BackupHomeData({ searchParams }: { searchParams: PageProps<"/sauvegarde">["searchParams"] }) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  if (query.trim()) {
    const hits = await backupSearch(query);
    return <SearchResults query={query} hits={hits} />;
  }
  return (
    <div className="backup-intro">
      <h1>Sauvegarde</h1>
      <p className="hint">
        Choisissez une page dans l&apos;arbre, ou cherchez ci-dessus. Le contenu est figé au moment du dump : rien ne
        s&apos;y modifie, la base vivante reste intacte.
      </p>
    </div>
  );
}

function SearchResults({ query, hits }: { query: string; hits: SearchHit[] }) {
  if (!hits.length) return <p className="hint">Aucun résultat pour « {query} ».</p>;
  return (
    <div className="backup-results">
      <h1>{hits.length} résultat{hits.length > 1 ? "s" : ""} pour « {query} »</h1>
      <ul className="search-hits">
        {hits.map((hit) => (
          <li key={hit.id}>
            <Link href={`/sauvegarde/${hit.id}`} className="search-hit-title">
              <PageLabel row={hit} mediaBase="/api/sauvegarde/media/" />
            </Link>
            <p className="search-hit-excerpt">
              <Highlighted text={hit.excerpt} />
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Les marqueurs de ts_headline deviennent des <mark>, comme dans la recherche
// de l'app.
function Highlighted({ text }: { text: string }) {
  return (
    <>
      {parseHeadline(text).map((segment, index) =>
        segment.hit ? (
          <mark key={index} className="hit">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
