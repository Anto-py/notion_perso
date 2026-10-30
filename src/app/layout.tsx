import type { Metadata } from "next";
import { Inter, Oswald } from "next/font/google";
import "./globals.css";

// Polices de la charte, servies par l'app elle-même (aucune requête vers
// Google côté navigateur). Exposées en variables CSS, lues par globals.css.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const oswald = Oswald({ subsets: ["latin"], variable: "--font-oswald" });

export const metadata: Metadata = {
  title: "notion_perso",
  description: "Pages, bases et veille, auto-hébergées",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning ne vaut que pour les attributs de <html>, où
    // des extensions (LanguageTool : data-lt-installed) écrivent avant React.
    <html lang="fr" className={`${inter.variable} ${oswald.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
