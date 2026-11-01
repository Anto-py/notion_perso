"use client";
// Configuration d'un cumul : la relation traversée, la propriété visée dans la
// base cible, le calcul et le format. La propriété visée vit dans l'autre
// base, d'où une lecture à la demande de GET /api/databases/[id], comme
// RelationPicker.
import { useEffect, useState } from "react";
import {
  FORMAT_LABELS,
  isTwin,
  NUMBER_FORMATS,
  ROLLUP_CALC_LABELS,
  rollupResultType,
  type NumberFormat,
  type Property,
  type RollupCalc,
} from "@/lib/properties";

// Calculs possibles selon le type de la propriété visée. « Compter les
// entrées liées » ne dépend pas d'elle ; les autres comptes acceptent tout
// type, la somme et les extrêmes numériques un Nombre, les dates une Date.
function calcsFor(target: Property | null): RollupCalc[] {
  if (!target) return ["count"];
  if (target.type === "number") return ["count", "count_filled", "percent", "sum", "avg", "min", "max"];
  if (target.type === "date") return ["count", "count_filled", "percent", "oldest", "newest"];
  return ["count", "count_filled", "percent"];
}

export function RollupEditor({
  prop,
  properties,
  onChange,
}: {
  prop: Property;
  properties: Property[];
  onChange: (patch: Partial<Property>) => void;
}) {
  const relations = properties.filter((item) => item.type === "relation" && !isTwin(item));
  const relation = relations.find((item) => item.id === prop.relation);
  const targetDbId = relation?.target;
  // La base chargée est retenue avec son id : changer de relation n'affiche
  // jamais les propriétés de la précédente pendant le chargement.
  const [loaded, setLoaded] = useState<{ db: string; props: Property[] } | null>(null);

  useEffect(() => {
    if (!targetDbId) return;
    let alive = true;
    void fetch(`/api/databases/${targetDbId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("introuvable");
        const data = (await response.json()) as { config?: { properties?: Property[] } };
        if (alive) setLoaded({ db: targetDbId, props: data.config?.properties ?? [] });
      })
      .catch(() => {
        if (alive) setLoaded({ db: targetDbId, props: [] });
      });
    return () => {
      alive = false;
    };
  }, [targetDbId]);

  const targetProps = targetDbId && loaded?.db === targetDbId ? loaded.props : null;
  const target = targetProps?.find((item) => item.id === prop.target) ?? null;
  const calc = prop.calc ?? "count";
  const choices = calcsFor(target);
  const shownCalcs = choices.includes(calc) ? choices : [...choices, calc];

  return (
    <>
      <select
        aria-label={`Relation de ${prop.name}`}
        value={prop.relation ?? ""}
        onChange={(event) => {
          const next = relations.find((item) => item.id === event.target.value);
          onChange({ relation: next?.id, target: undefined, calc: "count" });
        }}
      >
        <option value="">Choisir une relation</option>
        {relations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      {relations.length === 0 && <span className="hint schema-hint">Créez d&apos;abord une relation.</span>}
      {relation && !targetDbId && <span className="hint schema-hint">La base cible de cette relation a disparu.</span>}
      {targetDbId && (
        <select
          aria-label={`Propriété visée de ${prop.name}`}
          value={prop.target ?? ""}
          disabled={targetProps === null}
          onChange={(event) => {
            const id = event.target.value || undefined;
            const next = targetProps?.find((item) => item.id === id) ?? null;
            onChange({ target: id, calc: calcsFor(next)[0] ?? "count" });
          }}
        >
          {targetProps === null ? (
            <option value="">Chargement…</option>
          ) : (
            <option value="">Choisir une propriété</option>
          )}
          {prop.target && targetProps && !targetProps.some((item) => item.id === prop.target) && (
            <option value={prop.target}>Introuvable</option>
          )}
          {targetProps?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      )}
      {target && (
        <select aria-label={`Calcul de ${prop.name}`} value={calc} onChange={(event) => onChange({ calc: event.target.value as RollupCalc })}>
          {shownCalcs.map((choice) => (
            <option key={choice} value={choice}>
              {ROLLUP_CALC_LABELS[choice]}
            </option>
          ))}
        </select>
      )}
      {target && rollupResultType(calc) === "number" && (
        <select
          aria-label={`Format de ${prop.name}`}
          value={prop.format ?? "number"}
          onChange={(event) => onChange({ format: event.target.value as NumberFormat })}
        >
          {NUMBER_FORMATS.map((format) => (
            <option key={format} value={format}>
              {FORMAT_LABELS[format]}
            </option>
          ))}
        </select>
      )}
      {prop.relation && targetProps && !target && (
        <span className="hint schema-hint">Propriété visée introuvable : choisissez-en une.</span>
      )}
    </>
  );
}
