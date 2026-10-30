// Règles d'upload, sans accès disque : le navigateur les applique avant
// d'envoyer (refus immédiat d'un fichier trop lourd), le serveur les réapplique
// à la réception (seule vérification qui compte).

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// Liste fermée. Pas de SVG : servi depuis notre domaine, il pourrait exécuter
// du script. L'extension sur disque découle du type, jamais du nom envoyé.
export const ALLOWED_TYPES: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "application/pdf": "pdf",
};

export type UploadCheck =
  | { ok: true; ext: string }
  | { ok: false; status: 413 | 415; error: string };

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

export function checkUpload(file: { size: number; type: string }): UploadCheck {
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Fichier trop lourd (${formatSize(file.size)}) : la limite est de 100 Mo.`,
    };
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return {
      ok: false,
      status: 415,
      error: "Format refusé : seuls les images (PNG, JPEG, GIF, WebP, AVIF) et les PDF sont acceptés.",
    };
  }
  return { ok: true, ext };
}

// Nom de fichier tel que newId("up") + extension le produit. Toute autre forme
// est refusée avant d'approcher le disque (pas de « ../ » possible).
const STORED_NAME = new RegExp(`^up_[A-Za-z0-9_-]{16}\\.(${Object.values(ALLOWED_TYPES).join("|")})$`);

export function isStoredName(name: string): boolean {
  return STORED_NAME.test(name);
}
