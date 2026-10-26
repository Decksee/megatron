import { listSettings, type Settings } from "./db";

/** Nombre de noms qu'on peut donner à Mégatron pour s'adresser à l'utilisateur. */
export const MAX_NICKNAMES = 8;

/** Les noms choisis par l'utilisateur (« Dixie », « mon cœur »…), dans l'ordre de saisie. */
export function nicknames(settings: Settings): string[] {
  try {
    const list: unknown = JSON.parse(settings.nicknames || "[]");
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === "string" && n.trim() !== "").map((n) => n.trim()) : [];
  } catch {
    return [];
  }
}

/** Un des noms, au hasard mais stable sur une heure : il ne change pas à chaque rendu de l'écran. */
export function pickNickname(settings: Settings): string | null {
  const list = nicknames(settings);
  if (!list.length) return null;
  const slot = Math.floor(Date.now() / 3_600_000);
  return list[Math.abs(Math.imul(slot ^ 0x5bd1e995, 2654435761)) % list.length];
}

/** Pour les notifications : lu dans la base, un nom tiré au hasard à chaque fois. */
export async function nicknameNow(): Promise<string | null> {
  const list = nicknames(await listSettings().catch(() => ({})));
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

/** « Bonjour » → « Bonjour Dixie » (inchangé sans nom). */
export const withName = (word: string, name: string | null) => (name ? `${word} ${name}` : word);
