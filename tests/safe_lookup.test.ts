import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";
import { isPrivateAddress, isPrivateHost, safeLookup } from "@/lib/safe_lookup";

describe("isPrivateAddress", () => {
  it.each([
    ["0.0.0.0", "0/8"],
    ["0.1.2.3", "0/8"],
    ["10.0.0.1", "10/8"],
    ["10.255.255.255", "10/8"],
    ["100.64.0.1", "100.64/10, partage d'opérateur"],
    ["100.127.255.254", "100.64/10, borne haute"],
    ["127.0.0.1", "boucle"],
    ["127.12.0.9", "boucle, toute la /8"],
    ["169.254.169.254", "lien local, métadonnées d'hébergeur"],
    ["172.16.0.1", "172.16/12"],
    ["172.31.255.255", "172.16/12, borne haute"],
    ["192.168.1.10", "192.168/16"],
    ["::1", "boucle IPv6"],
    ["::", "adresse non précisée"],
    ["fc00::1", "fc00::/7"],
    ["fd12:3456::1", "fc00::/7, moitié fd"],
    ["fe80::1", "fe80::/10"],
    ["febf::1", "fe80::/10, borne haute"],
    ["::ffff:127.0.0.1", "IPv4 mappée, notation pointée"],
    ["::ffff:7f00:1", "IPv4 mappée, notation hexadécimale"],
    ["::FFFF:10.0.0.1", "IPv4 mappée, majuscules"],
  ])("refuse %s (%s)", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "100.63.255.255",
    "100.128.0.1",
    "172.15.0.1",
    "172.32.0.1",
    "192.169.0.1",
    "2001:4860:4860::8888",
    "fec0::1",
    "::ffff:8.8.8.8",
  ])("laisse passer l'adresse publique %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it("refuse ce qui n'est pas une adresse IP", () => {
    expect(isPrivateAddress("exemple.org")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("isPrivateHost", () => {
  it("juge une adresse littérale d'URL, crochets IPv6 compris", () => {
    expect(isPrivateHost(new URL("http://100.64.0.1/").hostname)).toBe(true);
    expect(isPrivateHost(new URL("http://[::ffff:127.0.0.1]/").hostname)).toBe(true);
    expect(isPrivateHost(new URL("http://[::1]/").hostname)).toBe(true);
    expect(isPrivateHost(new URL("http://8.8.8.8/").hostname)).toBe(false);
  });

  it("laisse un nom au DNS, qui le jugera à la connexion", () => {
    expect(isPrivateHost("exemple.org")).toBe(false);
  });
});

// Une adresse littérale se résout sans réseau : le test reste déterministe.
function lookup(host: string, all: boolean): Promise<{ address: string | LookupAddress[]; family?: number }> {
  return new Promise((resolve, reject) => {
    safeLookup(host, { all }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

describe("safeLookup", () => {
  it("échoue quand le nom résout vers une adresse privée", async () => {
    await expect(lookup("127.0.0.1", true)).rejects.toThrow(/privée/);
    await expect(lookup("127.0.0.1", false)).rejects.toThrow(/privée/);
    await expect(lookup("localhost", true)).rejects.toThrow(/privée/);
  });

  it("rend la liste quand on la demande, une adresse et sa famille sinon", async () => {
    await expect(lookup("8.8.8.8", true)).resolves.toEqual({ address: [{ address: "8.8.8.8", family: 4 }] });
    await expect(lookup("8.8.8.8", false)).resolves.toEqual({ address: "8.8.8.8", family: 4 });
  });
});
