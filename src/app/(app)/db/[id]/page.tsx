import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DatabaseView } from "@/components/DatabaseView";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { configOf, listEntries } from "@/lib/databases";
import { getPage } from "@/lib/pages";

// Base : en-tête, propriétés, vue Tableau ou Kanban.
export default function DatabaseRoute({ params }: PageProps<"/db/[id]">) {
  return (
    <Suspense fallback={<p className="page-loading">Chargement…</p>}>
      <DatabaseLoader params={params} />
    </Suspense>
  );
}

async function DatabaseLoader({ params }: Pick<PageProps<"/db/[id]">, "params">) {
  const { id } = await params;
  const user = await getCurrentUser();
  const page = await getPage(id);
  if (!page || page.trashedAt || page.type !== "database" || !canAccess(user, page, "read")) notFound();
  const entries = (await listEntries(page.id)).filter((entry) => canAccess(user, entry, "read"));
  return (
    <DatabaseView
      key={page.id}
      database={{ id: page.id, title: page.title, icon: page.icon }}
      config={configOf(page)}
      entries={entries}
    />
  );
}
