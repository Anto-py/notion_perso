import { TrashList } from "@/components/TrashList";
import { canAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { tryPurgeExpired } from "@/lib/media_cleanup_query";
import { countTrash, listTrash } from "@/lib/pages";

// Liste de la corbeille, partagée par l'écran /trash et Réglages › Corbeille.
// La lire purge d'abord ce qui a dépassé le délai, puis balaie les médias
// inutilisés.
export async function TrashPanel() {
  const user = await getCurrentUser();
  await tryPurgeExpired();
  const items = (await listTrash()).filter((item) => canAccess(user, item, "read"));
  const total = await countTrash();
  return (
    <TrashList
      total={total}
      items={items.map((item) => ({
        id: item.id,
        title: item.title,
        icon: item.icon,
        trashedAt: item.trashedAt.toISOString(),
      }))}
    />
  );
}
