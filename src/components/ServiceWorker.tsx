"use client";
// Enregistre public/sw.js, condition d'installation de la PWA. Un navigateur
// sans service worker garde l'app en onglet classique, sans message.
import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
