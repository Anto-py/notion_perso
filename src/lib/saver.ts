// Mécanique de sauvegarde automatique, hors de React pour être testable :
// les modifications s'accumulent, partent après un temps de calme, une seule
// requête à la fois. Un échec garde les modifications et réessaie ; il est
// signalé, jamais avalé.

export type Patch = { title?: string; body?: unknown[] };
export type SaveStatus = { state: "saved" | "pending" | "saving" } | { state: "error"; message: string };

type Options = {
  // Envoie le lot ; rejette avec un message lisible en cas d'échec.
  send: (patch: Patch, leaving: boolean) => Promise<void>;
  onStatus: (status: SaveStatus) => void;
  onSaved: (patch: Patch) => void;
  debounceMs?: number;
  retryMs?: number;
};

export type Saver = {
  queue: (patch: Patch) => void;
  // leaving : la page se ferme, l'envoi part tout de suite et sans retour d'état.
  flush: (leaving?: boolean) => Promise<void>;
  cancel: () => void;
  hasPending: () => boolean;
};

export function createSaver({ send, onStatus, onSaved, debounceMs = 800, retryMs = 5000 }: Options): Saver {
  let pending: Patch = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let failing = false;

  const hasPending = () => Object.keys(pending).length > 0;

  function schedule(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), delay);
  }

  async function flush(leaving = false): Promise<void> {
    clearTimeout(timer);
    if (inFlight || !hasPending()) return;
    const patch = pending;
    pending = {};
    inFlight = true;
    if (!leaving) onStatus({ state: "saving" });
    try {
      await send(patch, leaving);
      failing = false;
      onSaved(patch);
      onStatus({ state: hasPending() ? "pending" : "saved" });
      if (hasPending()) schedule(debounceMs);
    } catch (error) {
      // Les frappes arrivées pendant l'envoi priment sur le lot refusé.
      pending = { ...patch, ...pending };
      failing = true;
      onStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
      if (!leaving) schedule(retryMs);
    } finally {
      inFlight = false;
    }
  }

  function queue(patch: Patch) {
    pending = { ...pending, ...patch };
    // Pendant une panne, l'erreur reste affichée jusqu'au prochain succès.
    if (!failing) onStatus({ state: "pending" });
    schedule(failing ? retryMs : debounceMs);
  }

  function cancel() {
    clearTimeout(timer);
    pending = {};
  }

  return { queue, flush, cancel, hasPending };
}
