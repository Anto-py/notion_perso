// En-tête triable d'une colonne, en privé comme en public : un clic fait
// avancer le tri de cette colonne (croissant, décroissant, aucun), comme
// Notion. La flèche montre l'état ; le lecteur d'écran le lit dans l'aria-sort
// posé sur le th par l'appelant.
import type { ReactNode } from "react";
import type { Sort } from "@/lib/properties";

export function sortDir(sorts: readonly Sort[], propId: string): Sort["dir"] | null {
  return sorts.find((sort) => sort.prop === propId)?.dir ?? null;
}

export function ariaSort(dir: Sort["dir"] | null): "ascending" | "descending" | "none" {
  return dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none";
}

export function SortButton({
  label,
  icon,
  dir,
  onCycle,
}: {
  label: string;
  icon: ReactNode;
  dir: Sort["dir"] | null;
  onCycle: () => void;
}) {
  return (
    <button type="button" className="sort-handle" title={`Trier par ${label}`} onClick={onCycle}>
      <span className="prop-icon" aria-hidden="true">
        {icon}
      </span>
      {label}
      {dir && (
        <span className="sort-arrow" aria-hidden="true">
          {dir === "asc" ? "↑" : "↓"}
        </span>
      )}
    </button>
  );
}
