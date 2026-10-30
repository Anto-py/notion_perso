import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "notion_perso",
  description: "Pages, bases et veille, auto-hébergées",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
