// Réglages › Sauvegardes › restauration d'essai (palier e) : ce que le dernier
// essai a donné, source par source, et de quoi le relancer.
import { TRIAL_DAYS, type BackupTrial } from "@/lib/backup_rules";
import { TrialButton } from "./TrialButton";

const DATE = new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });
const SOURCE = { mac: "Sauvegarde du Mac", miroir: "Dump du miroir" } as const;

export function TrialReport({ trial }: { trial: BackupTrial | null }) {
  return (
    <div className="backup-trial">
      <h3>Restauration d&apos;essai</h3>
      <p className="hint">
        Tous les {TRIAL_DAYS} jours, la dernière sauvegarde du Mac et le dernier dump du miroir sont restaurés dans une base
        jetable, relus, puis effacés. Une sauvegarde jamais relue n&apos;est qu&apos;un espoir de sauvegarde.
      </p>
      {trial && <p className="hint">Dernière vérification : {DATE.format(new Date(trial.at))}.</p>}
      {!trial || trial.results.length === 0 ? (
        <p className="hint">Aucune sauvegarde à vérifier pour l&apos;instant.</p>
      ) : (
        <ul className="settings-list">
          {trial.results.map((result) => (
            <li key={`${result.source}-${result.file}`}>
              <span className="settings-list-name">{SOURCE[result.source]}</span>
              <span className="hint">
                {result.file || "aucun fichier"}
                {result.ok ? ` · ${result.pages} pages relues` : ` · ⚠ ${result.error ?? "illisible"}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="backup-trial-action">
        <TrialButton />
      </p>
    </div>
  );
}
