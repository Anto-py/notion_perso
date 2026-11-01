import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DatabaseView } from "@/components/DatabaseView";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { configOf, listEntries } from "@/lib/databases";
import { getPage, listDatabases } from "@/lib/pages";

// Base : en-tête, propriétés, onglets des vues (Tableau, Kanban, Liste).
export default function DatabaseRoute({ params, searchParams }: PageProps<"/db/[id]">) {
  return (
    <Suspense fallback={<p className="page-loading">Chargement…</p>}>
      <DatabaseLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function DatabaseLoader({ params, searchParams }: Pick<PageProps<"/db/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const { vue } = await searchParams;
  const user = await getCurrentUser();
  const page = await getPage(id);
  if (!page || page.trashedAt || page.type !== "database" || !canAccess(user, page, "read")) notFound();
  const entries = (await listEntries(page.id)).filter((entry) => canAccess(user, entry, "read"));
  // Cibles possibles d'une relation : toutes les bases, la base courante
  // comprise (BRAINSTORMING §13).
  const databases = (await listDatabases()).filter((database) => canAccess(user, database, "read"));
  return (
    <DatabaseView
      key={page.id}
      database={{
        id: page.id,
        title: page.title,
        icon: page.icon,
        cover: page.cover,
        coverPosition: page.coverPosition,
        publicId: page.shareEnabled ? page.publicId : null,
        rev: page.rev,
      }}
      config={configOf(page)}
      entries={entries}
      databases={databases.map(({ id: dbId, title, icon }) => ({ id: dbId, title, icon }))}
      initialViewId={typeof vue === "string" ? vue : null}
    />
  );
}
