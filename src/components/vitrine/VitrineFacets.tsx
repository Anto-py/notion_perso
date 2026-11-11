"use client";
// Filtres de la vitrine (§4, §7, §9) : sous « Domaines », le panorama en
// pastilles (12 plus fournis, « + n autres » déplie le reste) ; sous
// « Affiner », les menus Niveau, Prix et Type, rendus en champs de choix
// (« Prix : tous ▾ ») pour ne pas passer pour des étiquettes, et la bascule
// des coups de cœur ; puis la ligne des filtres actifs
// avec le compte, « Tout effacer » et « Copier le lien ». Une pastille ou une
// case à 0 est grisée et inerte, sauf si elle est active (on doit pouvoir
// la retirer).
import { useEffect, useId, useRef, useState } from "react";
import { CopyUrlButton } from "@/components/CopyUrlButton";
import { panorama, type Facet, type Facets, type Family } from "@/lib/vitrine";
import { menuValue, type ActiveFilter } from "@/lib/vitrine_state";

type Props = {
  facets: Facets;
  coeur: boolean;
  hasHearts: boolean;
  narrowed: boolean;
  shown: number;
  active: readonly ActiveFilter[];
  url: string;
  onToggle: (family: Family, slug: string) => void;
  onCoeur: () => void;
  onClear: () => void;
};

const MENUS: { family: Exclude<Family, "domaine">; label: string }[] = [
  { family: "niveau", label: "Niveau" },
  { family: "prix", label: "Prix" },
  { family: "type", label: "Type" },
];

export function VitrineFacets({ facets, coeur, hasHearts, narrowed, shown, active, url, onToggle, onCoeur, onClear }: Props) {
  const [expanded, setExpanded] = useState(false);
  const domainesId = useId();
  const affinerId = useId();
  const { top, rest } = panorama(facets.domaine);
  const pills = expanded ? [...top, ...rest] : top;
  return (
    <div className="vitrine-facets">
      {facets.domaine.length ? (
        <div className="vitrine-facet-group">
          <p id={domainesId} className="vitrine-facet-heading">
            Domaines
          </p>
          <ul className="vitrine-panorama" aria-labelledby={domainesId}>
            {pills.map((facet) => (
              <li key={facet.slug}>
                <Pill facet={facet} onClick={() => onToggle("domaine", facet.slug)} />
              </li>
            ))}
            {rest.length ? (
              <li>
                <button type="button" className="vitrine-pill-more" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "Réduire" : `+ ${rest.length} autres`}
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <div className="vitrine-facet-group">
        <p id={affinerId} className="vitrine-facet-heading">
          Affiner
        </p>
        <div className="vitrine-menus" role="group" aria-labelledby={affinerId}>
          {MENUS.map(({ family, label }) =>
            facets[family].length ? (
              <FacetMenu key={family} label={label} facets={facets[family]} onToggle={(slug) => onToggle(family, slug)} />
            ) : null,
          )}
          {hasHearts ? (
            <button type="button" className="vitrine-coeur" aria-pressed={coeur} onClick={onCoeur}>
              ★ Coups de cœur
            </button>
          ) : null}
        </div>
      </div>
      {narrowed ? (
        <div className="vitrine-active">
          <span role="status">
            {shown} {shown > 1 ? "ressources" : "ressource"}
          </span>
          {active.map((filter) => (
            <button
              key={`${filter.family}:${filter.slug}`}
              type="button"
              className="vitrine-chip"
              aria-label={`Retirer le filtre ${filter.label}`}
              onClick={() => (filter.family === "coeur" ? onCoeur() : onToggle(filter.family, filter.slug))}
            >
              {filter.label} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className="vitrine-clear" onClick={onClear}>
            Tout effacer
          </button>
          <CopyUrlButton url={url} label="Copier le lien" />
        </div>
      ) : null}
    </div>
  );
}

function Pill({ facet, onClick }: { facet: Facet; onClick: () => void }) {
  const inert = !facet.count && !facet.active;
  return (
    <button type="button" className="vitrine-pill" aria-pressed={facet.active} disabled={inert} onClick={onClick}>
      {facet.label} · {facet.count}
    </button>
  );
}

// Menu déroulant à cases : <details> natif, refermé par un clic ailleurs ou
// par Échap (le focus revient au titre).
function FacetMenu({ label, facets, onToggle }: { label: string; facets: readonly Facet[]; onToggle: (slug: string) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const activeCount = facets.filter((facet) => facet.active).length;

  useEffect(() => {
    function close(event: PointerEvent) {
      const node = menu.current;
      if (node?.open && !node.contains(event.target as Node)) node.open = false;
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  return (
    <details
      ref={menu}
      className="vitrine-menu"
      onKeyDown={(event) => {
        const node = menu.current;
        if (event.key !== "Escape" || !node?.open) return;
        event.preventDefault();
        node.open = false;
        node.querySelector("summary")?.focus();
      }}
    >
      <summary data-active={activeCount > 0 || undefined}>
        <span className="vitrine-menu-name">{label} :</span> <span className="vitrine-menu-value">{menuValue(facets)}</span>
        <span className="vitrine-menu-caret" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="vitrine-menu-list">
        {facets.map((facet) => (
          <label key={facet.slug} className="vitrine-menu-item" data-inert={(!facet.count && !facet.active) || undefined}>
            <input
              type="checkbox"
              checked={facet.active}
              disabled={!facet.count && !facet.active}
              onChange={() => onToggle(facet.slug)}
            />
            {facet.label} ({facet.count})
          </label>
        ))}
      </div>
    </details>
  );
}
