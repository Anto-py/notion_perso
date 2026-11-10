"use client";
// Logo d'une ressource de la vitrine (§5, §12), trois replis : le logo du site
// servi par notre serveur (le navigateur n'appelle jamais le site tiers),
// sinon l'icône de l'entrée, sinon l'initiale du titre sur un rond coloré.
//
// Une image qui échoue avant l'hydratation ne déclenche aucun onError côté
// React : le ref relit alors son état (complete sans largeur) au montage.
import { useState } from "react";
import { iconSrc, parseIcon } from "@/lib/icons";
import { initialColor, type VitrineEntry } from "@/lib/vitrine";

type Props = { entry: Pick<VitrineEntry, "logo" | "icon" | "title">; big?: boolean };

export function VitrineLogo({ entry, big = false }: Props) {
  // Adresses en échec, gardées par adresse : la fiche change d'entrée sans
  // remonter le composant.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const fail = (src: string) => setFailed((before) => (before.has(src) ? before : new Set(before).add(src)));
  const className = big ? "vitrine-logo vitrine-logo-big" : "vitrine-logo";

  const icon = parseIcon(entry.icon);
  const iconUrl = icon?.kind === "image" ? iconSrc(icon.filename) : null;
  const src = [entry.logo, iconUrl].find((url): url is string => Boolean(url) && !failed.has(url!));
  if (src) {
    return (
      // Carré de quelques pixels servi par notre domaine : next/image n'y
      // apporte rien.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={src}
        className={className}
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        onError={() => fail(src)}
        ref={(node) => {
          if (node && node.complete && node.naturalWidth === 0) fail(src);
        }}
      />
    );
  }
  if (icon?.kind === "emoji") {
    return (
      <span className={`${className} vitrine-logo-emoji`} aria-hidden="true">
        {icon.emoji}
      </span>
    );
  }
  const initial = Array.from(entry.title.trim())[0]?.toLocaleUpperCase("fr") ?? "?";
  return (
    <span className={`${className} vitrine-logo-initial chip-${initialColor(entry.title)}`} aria-hidden="true">
      {initial}
    </span>
  );
}
