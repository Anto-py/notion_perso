// Réglages › Sauvegardes, sur le Mac (BRAINSTORMING §12) : les dumps de la
// base locale faits par le lanceur, avec date, taille et motif. « Ouvrir » et
// la restauration d'essai : paliers (d) et (e) de l'étape 12.
import { backupMotive, BACKUPS_KEPT } from "@/lib/backup_rules";
import type { BackupEntry } from "@/lib/backups";
import { formatBytes } from "@/lib/sync_status";

const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });

export function BackupsSection({ dir, backups }: { dir: string | null; backups: BackupEntry[] }) {
  return (
    <section id="sauvegardes" className="settings-section">
      <h2>Sauvegardes</h2>
      <p className="hint">
        Une copie de la base locale à chaque premier lancement du jour et avant chaque mise à jour. Les{" "}
        {BACKUPS_KEPT.daily} dernières quotidiennes et les {BACKUPS_KEPT.update} dernières d&apos;avant mise à jour sont
        gardées. Les images effacées passent 30 jours en quarantaine.
      </p>
      {!dir ? (
        <p className="hint">Sauvegardes faites par le lanceur de l&apos;app : aucun dossier indiqué à ce serveur.</p>
      ) : backups.length === 0 ? (
        <p className="hint">Aucune sauvegarde pour l&apos;instant.</p>
      ) : (
        <ul className="settings-list">
          {backups.map((backup) => (
            <li key={backup.name}>
              <span className="settings-list-name">{DATE.format(backup.at)}</span>
              <span className="hint">
                {backupMotive(backup)} · {formatBytes(backup.size)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
