// Réglages › Sauvegardes, sur le Mac (BRAINSTORMING §12) : les dumps de la
// base locale faits par le lanceur et les copies du dump du serveur (palier f),
// avec date, taille et motif, de quoi les ouvrir en lecture seule, l'état de
// la dernière copie et le résultat de la restauration d'essai.
import Link from "next/link";
import { backupMotive, BACKUPS_KEPT, type BackupTrial, type OpenBackup, type ServerCopy } from "@/lib/backup_rules";
import type { BackupEntry } from "@/lib/backups";
import { formatBytes } from "@/lib/sync_status";
import { OpenBackupButton } from "./OpenBackupButton";
import { TrialReport } from "./TrialReport";

const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });

export function BackupsSection({
  dir,
  backups,
  open,
  trial,
  server,
}: {
  dir: string | null;
  backups: BackupEntry[];
  open: OpenBackup | null;
  trial: BackupTrial | null;
  server: { configured: boolean; copy: ServerCopy | null };
}) {
  return (
    <section id="sauvegardes" className="settings-section">
      <h2>Sauvegardes</h2>
      <p className="hint">
        Une copie de la base locale à chaque premier lancement du jour et avant chaque mise à jour. Les{" "}
        {BACKUPS_KEPT.daily} dernières quotidiennes et les {BACKUPS_KEPT.update} dernières d&apos;avant mise à jour sont
        gardées. Le dump nocturne du serveur est recopié une fois par jour, app ouverte, et ses{" "}
        {BACKUPS_KEPT.server} dernières copies sont gardées. Les images effacées passent 30 jours en quarantaine.
      </p>
      {dir && <ServerCopyState {...server} />}
      {open && (
        <p className="hint">
          Sauvegarde ouverte : <Link href="/sauvegarde">reprendre la consultation</Link>.
        </p>
      )}
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
              <OpenBackupButton name={backup.name} />
            </li>
          ))}
        </ul>
      )}
      {dir && <TrialReport trial={trial} />}
    </section>
  );
}

const RESULT = { copied: "copiée et relue", unreadable: "⚠ illisible, non gardée", failed: "⚠ ratée" } as const;

// La dernière copie tentée ; l'alerte de la ligne d'état renvoie ici.
function ServerCopyState({ configured, copy }: { configured: boolean; copy: ServerCopy | null }) {
  if (!configured) {
    return (
      <p className="hint">
        Copie du serveur non réglée : NOTION_APP_VPS_HOTE, NOTION_APP_VPS_CLE et NOTION_APP_VPS_DUMPS manquent dans app.conf.
      </p>
    );
  }
  if (!copy) return <p className="hint">Copie du serveur : aucune tentative pour l&apos;instant.</p>;
  return (
    <p className="hint">
      Dernière copie du serveur, le {DATE.format(new Date(copy.at))} : {RESULT[copy.result]}
      {copy.remote ? ` (${copy.remote})` : ""}
      {copy.error ? ` · ${copy.error}` : ""}.
    </p>
  );
}
