import type { Metadata, Viewport } from "next";
import { Inter, Oswald } from "next/font/google";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

// Polices de la charte, servies par l'app elle-même (aucune requête vers
// Google côté navigateur). Exposées en variables CSS, lues par globals.css.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const oswald = Oswald({ subsets: ["latin"], variable: "--font-oswald" });

export const metadata: Metadata = {
  title: "notion_perso",
  description: "Pages, bases et veille, auto-hébergées",
  // Icônes rangées dans public/icons/, que le proxy laisse passer sans
  // session : l'écran de connexion les affiche aussi.
  icons: {
    icon: [{ url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "notion_perso", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f2efe6",
  // Le clavier d'un téléphone réduit la page au lieu de la recouvrir : ce que
  // BlockNote demande en console, et ce qui garde la saisie visible.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning ne vaut que pour les attributs de <html>, où
    // des extensions (LanguageTool : data-lt-installed) écrivent avant React.
    <html lang="fr" className={`${inter.variable} ${oswald.variable}`} suppressHydrationWarning>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
