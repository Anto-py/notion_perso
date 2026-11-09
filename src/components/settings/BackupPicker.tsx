// Réglages › Sauvegardes : un menu déroulant des dumps, le plus récent
// d'abord, et le bouton qui ouvre celui qu'on choisit. Le choix reste local :
// la sauvegarde ne s'ouvre qu'au clic, jamais au changement de ligne.
"use client";
import { useState } from "react";
import { backupMotive } from "@/lib/backup_rules";
import type { BackupEntry } from "@/lib/backups";
import { formatBytes } from "@/lib/sync_status";
import { DeleteBackupButton } from "./DeleteBackupButton";
import { OpenBackupButton } from "./OpenBackupButton";

const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });

export function BackupPicker({ backups }: { backups: BackupEntry[] }) {
  const [selected, setSelected] = useState(backups[0]?.name ?? "");
  // Une rotation peut effacer la sauvegarde choisie : on retombe sur la plus
  // récente plutôt que d'afficher un choix absent de la liste.
  const chosen = backups.some((backup) => backup.name === selected) ? selected : (backups[0]?.name ?? "");
  return (
    <div className="backup-picker">
      <label htmlFor="backup-choice">Sauvegarde</label>
      <select id="backup-choice" value={chosen} onChange={(event) => setSelected(event.target.value)}>
        {backups.map((backup) => (
          <option key={backup.name} value={backup.name}>
            {DATE.format(backup.at)} · {backupMotive(backup)} · {formatBytes(backup.size)}
          </option>
        ))}
      </select>
      <OpenBackupButton name={chosen} />
      <DeleteBackupButton name={chosen} />
    </div>
  );
}
