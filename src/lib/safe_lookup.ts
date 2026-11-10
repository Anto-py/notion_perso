// Garde DNS des requêtes sortantes du serveur (aperçus de liens, images
// distantes, vitrine). Le contrôle des noms d'hôte par motif, dans unfurl.ts,
// ne voit pas l'adresse que le DNS rendra : un nom public peut résoudre vers
// 127.0.0.1 (DNS rebinding). safeLookup refait la résolution au moment de la
// connexion et refuse toute réponse privée ; isPrivateHost couvre les adresses
// écrites telles quelles dans l'URL, que Node connecte sans passer par le DNS.
import { lookup, type LookupAddress, type LookupOptions } from "node:dns";
import { isIP } from "node:net";

// Plages IPv4 privées ou spéciales, en [premier octet, masque sur 32 bits].
const PRIVATE_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // « ce réseau »
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // partage d'opérateur (CGNAT), souvent le réseau interne d'un hébergeur
  ["127.0.0.0", 8], // boucle
  ["169.254.0.0", 16], // lien local, dont le service de métadonnées des hébergeurs
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

function isPrivateV4(ip: string): boolean {
  const value = v4ToInt(ip);
  return PRIVATE_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = v4ToInt(base);
    return value >= start && value < start + size;
  });
}

// Les huit groupes de 16 bits d'une adresse IPv6 valide (isIP === 6), « :: »
// déplié et queue IPv4 éventuelle (::ffff:127.0.0.1) convertie en deux groupes.
function v6Groups(ip: string): number[] {
  let text = ip.toLowerCase().replace(/%.*$/, "");
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const value = v4ToInt(tail[1]);
    text = `${text.slice(0, tail.index)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const [head, rest] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = rest === undefined ? [] : rest ? rest.split(":") : [];
  const zeros = rest === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...zeros, ...right].map((group) => parseInt(group, 16));
}

// Vrai pour une adresse que le serveur ne doit jamais joindre ; vrai aussi pour
// ce qui n'est pas une adresse IP : dans le doute, on refuse.
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family !== 6) return true;
  const groups = v6Groups(ip);
  const leadingZeros = groups.slice(0, 5).every((group) => group === 0);
  if (leadingZeros && groups[5] === 0xffff) {
    // IPv4 « mappée » : jugée sur les plages IPv4.
    return isPrivateV4(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`);
  }
  if (leadingZeros && groups[5] === 0 && groups[6] === 0 && groups[7] <= 1) return true; // :: et ::1
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7, adresses uniques locales
  return (groups[0] & 0xffc0) === 0xfe80; // fe80::/10, lien local
}

// Hôte d'une URL (`URL.hostname`, crochets IPv6 compris) : vrai s'il s'agit
// d'une adresse littérale privée. Un nom rend faux : le DNS le jugera à la
// connexion, par safeLookup.
export function isPrivateHost(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, "");
  return isIP(bare) !== 0 && isPrivateAddress(bare);
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

// Remplaçant de dns.lookup pour `connect.lookup` d'un Agent undici : toutes
// les adresses du nom sont résolues, et une seule privée suffit à refuser
// (sinon la connexion pourrait choisir celle-là). Rend la forme demandée par
// l'appelant : la liste quand `all` est posé (Node 22, choix automatique de la
// famille), une adresse et sa famille sinon.
export function safeLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
      return;
    }
    const refused = addresses.find((entry) => isPrivateAddress(entry.address));
    if (refused || addresses.length === 0) {
      const blocked: NodeJS.ErrnoException = new Error(`Adresse privée refusée pour ${hostname}`);
      blocked.code = "EPRIVATEADDR";
      callback(blocked, []);
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}
