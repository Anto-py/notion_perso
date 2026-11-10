import { VitrineRoot } from "@/components/vitrine/VitrineRoot";
import "./vitrine.css";

// Vitrine de veille (/veille), hors coquille de l'app : ni barre latérale ni
// onglets. Tout son style vit sous .vitrine (vitrine.css, importé ici) ;
// VitrineRoot y ajoute le fond quand la page, cartes comprises, a signalé
// leur arrivée (VitrineFond).
export default function VeilleLayout({ children }: LayoutProps<"/veille">) {
  return <VitrineRoot>{children}</VitrineRoot>;
}
