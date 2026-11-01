// Coquille de l'écran de sauvegarde (palier d de l'étape 12) : le bandeau,
// l'arbre et la recherche de la copie, à la place de la barre latérale de
// l'app. La session est vérifiée ici ; sans sauvegarde ouverte, on revient à
// Réglages, d'où l'ouverture se fait.
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { backupTree } from "@/lib/backup_read";
import { readOpenBackup } from "@/lib/backups";
import { BackupBanner } from "./BackupBanner";
import { BackupTree } from "./BackupTree";

export async function BackupShell({ children }: { children: ReactNode }) {
  await getCurrentUser();
  const open = await readOpenBackup();
  if (!open) redirect("/reglages#sauvegardes");
  const rows = await backupTree();
  return (
    <div className="backup-shell">
      <BackupBanner at={new Date(open.at)} />
      <div className="backup-body">
        <aside className="backup-nav">
          <form action="/sauvegarde" className="backup-search">
            <input
              type="search"
              name="q"
              placeholder="Rechercher dans la sauvegarde"
              aria-label="Rechercher dans la sauvegarde"
            />
            <button type="submit">Chercher</button>
          </form>
          <BackupTree rows={rows} />
        </aside>
        <main className="backup-main">{children}</main>
      </div>
    </div>
  );
}
