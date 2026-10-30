import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "notion_perso",
  description: "Pages, bases et veille, auto-hébergées",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning ne vaut que pour les attributs de <html>, où
    // des extensions (LanguageTool : data-lt-installed) écrivent avant React.
    <html lang="fr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
