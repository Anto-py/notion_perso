import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DatabaseView } from "@/components/DatabaseView";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { configOf, listEntries } from "@/lib/databases";
import { getPage } from "@/lib/pages";

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
      initialViewId={typeof vue === "string" ? vue : null}
    />
  );
}
