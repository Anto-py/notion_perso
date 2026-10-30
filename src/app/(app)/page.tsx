import Link from "next/link";
import { Suspense } from "react";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { listRecent } from "@/lib/pages";
import { PageLabel } from "@/components/PageIcon";

// Accueil : pages modifiées en dernier. L'invite à l'import viendra à l'étape 6.
export default function Accueil() {
  return (
    <main className="page">
      <h1>Accueil</h1>
      <Suspense fallback={<p>Chargement…</p>}>
        <Recent />
      </Suspense>
    </main>
  );
}

const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium", timeZone: "Europe/Brussels" });

async function Recent() {
  const user = await getCurrentUser();
  const pages = (await listRecent()).filter((page) => canAccess(user, page, "read"));
  if (pages.length === 0) {
    return <p>Aucune page pour l&apos;instant. Créez la première avec « + Nouvelle page », dans la barre de gauche.</p>;
  }
  return (
    <>
      <h2>Modifiées récemment</h2>
      <ul className="recent">
        {pages.map((page) => (
          <li key={page.id}>
            <Link href={page.type === "database" ? `/db/${page.id}` : `/page/${page.id}`}><PageLabel row={page} /></Link>
            <span className="hint">{DATE.format(page.updatedAt)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
