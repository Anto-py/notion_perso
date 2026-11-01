import { Suspense } from "react";
import { BackupShell } from "@/components/backup/BackupShell";

// Écran de sauvegarde hors de la coquille de l'app (palier d de l'étape 12) :
// ni barre latérale vivante ni geste d'écriture, seulement la copie figée.
export default function BackupLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<p className="page-loading">Ouverture de la sauvegarde…</p>}>
      <BackupShell>{children}</BackupShell>
    </Suspense>
  );
}
