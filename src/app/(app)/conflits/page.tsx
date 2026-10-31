import Link from "next/link";
import { Suspense } from "react";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { listConflictPages } from "@/lib/conflicts";

// Liste des pages qui portent un encadré de conflit (BRAINSTORMING §11), pour
// qu'aucune copie ne s'oublie dans une page peu ouverte. Ouverte depuis la
// ligne « ⚠ 1 conflit » de la barre latérale.
export default function ConflictsPage() {
  return (
    <main className="page">
      <h1>Conflits à trier</h1>
      <p className="hint">
        Une fusion a gardé une version sous l&apos;autre. Ouvrez la page et tranchez avec « Garder celle-ci » ou
        « Garder l&apos;autre ».
      </p>
      <Suspense fallback={<p>Chargement…</p>}>
        <ConflictList />
      </Suspense>
    </main>
  );
}

async function ConflictList() {
  const user = await getCurrentUser();
  const pages = (await listConflictPages()).filter((page) => canAccess(user, page, "read"));
  if (pages.length === 0) return <p>Aucune page ne porte de conflit.</p>;
  return (
    <ul className="conflict-list">
      {pages.map((page) => (
        <li key={page.id}>
          <Link href={page.type === "database" ? `/db/${page.id}` : `/page/${page.id}`}>
            {page.title || "Sans titre"}
          </Link>
        </li>
      ))}
    </ul>
  );
}
