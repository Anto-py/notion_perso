// Service worker de notion_perso : il rend l'app installable, rien de plus.
// Aucun gestionnaire fetch, donc aucune requête interceptée ni mise en cache :
// pas de hors-ligne en v1 (docs/IDEA.md), et rien qui survive pour gêner un
// autre projet servi plus tard sur le même port.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
