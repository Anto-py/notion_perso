import { Suspense } from "react";
import { TrashList } from "@/components/TrashList";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { listTrash, purgeExpired, TRASH_RETENTION_DAYS } from "@/lib/pages";

export default function TrashPage() {
  return (
    <main className="page">
      <h1>Corbeille</h1>
      <p className="hint">Les éléments sont supprimés définitivement après {TRASH_RETENTION_DAYS} jours.</p>
      <Suspense fallback={<p>Chargement…</p>}>
        <TrashData />
      </Suspense>
    </main>
  );
}

// Ouvrir la corbeille purge d'abord ce qui a dépassé le délai.
async function TrashData() {
  const user = await getCurrentUser();
  await purgeExpired();
  const items = (await listTrash()).filter((item) => canAccess(user, item, "read"));
  return (
    <TrashList
      items={items.map((item) => ({
        id: item.id,
        title: item.title,
        icon: item.icon,
        trashedAt: item.trashedAt.toISOString(),
      }))}
    />
  );
}
