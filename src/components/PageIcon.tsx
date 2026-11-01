// Icône d'une page, emoji ou image, et libellé « icône + titre ». Sans hook :
// rendu aussi bien par le serveur (vue publique) que par le navigateur.
import { iconSrc, MEDIA_BASE, resolveIcon } from "@/lib/icons";

type Row = { icon: string | null; title: string; type?: string };

export function PageIcon({
  icon,
  type,
  big = false,
  mediaBase = MEDIA_BASE,
}: {
  icon: string | null | undefined;
  type?: string;
  big?: boolean;
  mediaBase?: string;
}) {
  const resolved = resolveIcon(icon, type);
  const className = big ? "page-icon page-icon-big" : "page-icon";
  if (resolved.kind === "image") {
    // Image de la bibliothèque, servie par /api/media : next/image n'apporte
    // rien à un carré de quelques pixels.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`${className} page-icon-img`} src={iconSrc(resolved.filename, mediaBase)} alt="" aria-hidden="true" />;
  }
  return (
    <span className={className} aria-hidden="true">
      {resolved.emoji}
    </span>
  );
}

export function PageLabel({ row, mediaBase }: { row: Row; mediaBase?: string }) {
  return (
    <>
      <PageIcon icon={row.icon} type={row.type} mediaBase={mediaBase} /> {row.title || "Sans titre"}
    </>
  );
}
