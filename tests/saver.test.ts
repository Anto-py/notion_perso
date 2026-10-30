import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaver, type Patch, type SaveStatus } from "@/lib/saver";

function setup(send: (patch: Patch) => Promise<void>) {
  const statuses: SaveStatus[] = [];
  const saved: Patch[] = [];
  const sendSpy = vi.fn(send);
  const saver = createSaver({
    send: (patch) => sendSpy(patch),
    onStatus: (status) => statuses.push(status),
    onSaved: (patch) => saved.push(patch),
    debounceMs: 800,
    retryMs: 5000,
  });
  return { saver, sendSpy, statuses, saved, last: () => statuses.at(-1) };
}

describe("createSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("regroupe les frappes et n'envoie qu'après le temps de calme", async () => {
    const { saver, sendSpy, last } = setup(async () => {});
    saver.queue({ title: "a" });
    saver.queue({ title: "ab" });
    saver.queue({ body: [] });
    expect(last()).toEqual({ state: "pending" });
    await vi.advanceTimersByTimeAsync(799);
    expect(sendSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledWith({ title: "ab", body: [] });
    expect(last()).toEqual({ state: "saved" });
  });

  it("garde les modifications après un échec, le signale, et réessaie", async () => {
    let online = false;
    const { saver, sendSpy, saved, last } = setup(async () => {
      if (!online) throw new Error("Connexion perdue");
    });
    saver.queue({ title: "x" });
    await vi.advanceTimersByTimeAsync(800);
    expect(last()).toEqual({ state: "error", message: "Connexion perdue" });
    expect(saver.hasPending()).toBe(true);

    // Une frappe pendant la panne ne masque pas l'erreur et rejoint le lot.
    saver.queue({ body: [1] });
    expect(last()).toEqual({ state: "error", message: "Connexion perdue" });

    online = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(sendSpy).toHaveBeenLastCalledWith({ title: "x", body: [1] });
    expect(saved).toEqual([{ title: "x", body: [1] }]);
    expect(last()).toEqual({ state: "saved" });
  });

  it("n'envoie qu'une requête à la fois, la frappe suivante part après", async () => {
    let release: () => void = () => {};
    const { saver, sendSpy, last } = setup(() => new Promise<void>((resolve) => (release = resolve)));
    saver.queue({ title: "1" });
    await vi.advanceTimersByTimeAsync(800);
    saver.queue({ title: "2" });
    await vi.advanceTimersByTimeAsync(800);
    expect(sendSpy).toHaveBeenCalledOnce();

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toEqual({ state: "pending" });
    await vi.advanceTimersByTimeAsync(800);
    expect(sendSpy).toHaveBeenLastCalledWith({ title: "2" });
  });

  it("flush envoie sans attendre ; cancel abandonne ce qui n'est pas parti", async () => {
    const { saver, sendSpy } = setup(async () => {});
    saver.queue({ title: "vite" });
    await saver.flush(true);
    expect(sendSpy).toHaveBeenCalledWith({ title: "vite" });

    saver.queue({ title: "jamais" });
    saver.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendSpy).toHaveBeenCalledOnce();
  });
});
