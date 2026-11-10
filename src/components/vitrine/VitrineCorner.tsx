// Coins ornés du cadre de la vitrine (§13), variante A « feuille simple » de
// la charte rétrofuturisme : un seul dessin, retourné en miroir par le CSS
// (vitrine.css, .vitrine-corner-*). Seul endroit orné de la page. Sans hook.
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

export function VitrineCorner({ corner }: { corner: (typeof CORNERS)[number] }) {
  return (
    <svg
      className={`vitrine-corner vitrine-corner-${corner}`}
      viewBox="0 0 60 60"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5,5 C5,5 20,5 30,15 C40,25 35,40 35,40 C35,40 25,30 15,30 C5,30 5,5 5,5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="8" cy="8" r="3" />
      <path d="M15,15 Q20,10 25,18" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function VitrineCorners() {
  return CORNERS.map((corner) => <VitrineCorner key={corner} corner={corner} />);
}
