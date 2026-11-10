// Vitrine de veille (/veille), hors coquille de l'app : ni barre latérale ni
// onglets. Tout son style vivra sous .vitrine (vitrine.css, importé ici).
export default function VeilleLayout({ children }: LayoutProps<"/veille">) {
  return <div className="vitrine">{children}</div>;
}
