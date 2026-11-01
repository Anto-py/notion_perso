// Bandeau d'une page, couleur de la palette ou image recadrée (BRAINSTORMING
// §1 ter). Sans hook : rendu aussi bien par le serveur (vue publique) que par
// le navigateur. La position verticale s'applique à l'image seule.
import { coverPosition, parseCover } from "@/lib/covers";
import { iconSrc, MEDIA_BASE } from "@/lib/icons";

type Props = {
  cover: string | null | undefined;
  position: number | null | undefined;
  className?: string;
  mediaBase?: string;
};

export function PageCover({ cover, position, className = "page-cover", mediaBase = MEDIA_BASE }: Props) {
  const parsed = parseCover(cover);
  if (!parsed) return null;
  if (parsed.kind === "color") {
    return <div className={`${className} cover-${parsed.color}`} aria-hidden="true" />;
  }
  return (
    <div className={className} aria-hidden="true">
      {/* Média de la page, servi par /api/media : next/image n'apporte rien à
          une bande recadrée en background-size: cover. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={iconSrc(parsed.filename, mediaBase)} alt="" style={{ objectPosition: `center ${coverPosition(position)}%` }} />
    </div>
  );
}
