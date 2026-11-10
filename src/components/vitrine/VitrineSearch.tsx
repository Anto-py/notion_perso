"use client";
// Champ de recherche de la vitrine (§2). Contrôlé par Vitrine, qui attend
// 200 ms et interroge le serveur dès la 2e lettre ; Entrée ne fait rien de
// plus. 200 caractères au plus, comme la coupe du serveur.
import { QUERY_MAX } from "@/lib/vitrine";

type Props = { value: string; failed: boolean; onChange: (value: string) => void };

export function VitrineSearch({ value, failed, onChange }: Props) {
  return (
    <form role="search" className="vitrine-search" action="/veille" onSubmit={(event) => event.preventDefault()}>
      <input
        type="search"
        name="q"
        className="vitrine-search-input"
        value={value}
        maxLength={QUERY_MAX}
        placeholder="Chercher un outil, un usage…"
        aria-label="Chercher dans la veille"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button type="button" className="vitrine-search-clear" aria-label="Effacer la recherche" onClick={() => onChange("")}>
          ✕
        </button>
      ) : null}
      {failed ? (
        <p className="vitrine-search-error" role="status">
          La recherche ne répond pas, réessaie dans un instant.
        </p>
      ) : null}
    </form>
  );
}
