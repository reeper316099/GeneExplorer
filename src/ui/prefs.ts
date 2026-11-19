// Typed, corruption-safe preference storage (theme, recent searches, favorites) in the renderer's localStorage.
// Anything that fails to parse or validate is discarded (a copy is kept under a ".corrupt" key) and defaults are used.
import { z } from 'zod';

export const TargetSchema = z.object({
  kind: z.enum(['ncbi_gene', 'uniprot']),
  id: z.string().min(1).max(30),
});
export type Target = z.infer<typeof TargetSchema>;

const EntrySchema = z.object({
  target: TargetSchema,
  label: z.string().max(80),
  sub: z.string().max(160),
  at: z.number(),
});
export type PrefEntry = z.infer<typeof EntrySchema>;

const PrefsSchema = z.object({
  version: z.literal(1),
  theme: z.enum(['light', 'dark', 'system']),
  recents: z.array(EntrySchema).max(20),
  favorites: z.array(EntrySchema).max(200),
});
export type Prefs = z.infer<typeof PrefsSchema>;

const KEY = 'geneexplorer.prefs.v1';
export const DEFAULT_PREFS: Prefs = { version: 1, theme: 'system', recents: [], favorites: [] };

/** Result of loading: the prefs plus whether stored data had to be discarded. */
export interface LoadedPrefs {
  prefs: Prefs;
  recovered: boolean;
}

/** Reads preferences; invalid or unreadable data falls back to defaults and is reported as recovered. */
export function loadPrefs(storage: Pick<Storage, 'getItem' | 'setItem'> = safeStorage()): LoadedPrefs {
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return { prefs: structuredClone(DEFAULT_PREFS), recovered: false };
  }
  if (raw === null) return { prefs: structuredClone(DEFAULT_PREFS), recovered: false };
  try {
    const parsed = PrefsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { prefs: parsed.data, recovered: false };
  } catch {
    // fall through to recovery
  }
  try {
    storage.setItem(`${KEY}.corrupt`, raw);
  } catch {
    // ignore: storage may be full or blocked
  }
  return { prefs: structuredClone(DEFAULT_PREFS), recovered: true };
}

/** Writes preferences; returns false if storage refused (the app keeps working in memory). */
export function savePrefs(
  prefs: Prefs,
  storage: Pick<Storage, 'getItem' | 'setItem'> = safeStorage(),
): boolean {
  try {
    storage.setItem(KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

/** Storage that never throws on access (private mode, quota). */
function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
  }
}

/** Identity key of an entry, used to avoid duplicates. */
export function entryKey(t: Target): string {
  return `${t.kind}:${t.id}`;
}

/** Adds an entry to the front of recents (deduplicated, capped at 20). */
export function addRecent(prefs: Prefs, entry: PrefEntry): Prefs {
  const rest = prefs.recents.filter((r) => entryKey(r.target) !== entryKey(entry.target));
  return { ...prefs, recents: [entry, ...rest].slice(0, 20) };
}

/** Adds or removes a favorite. */
export function toggleFavorite(prefs: Prefs, entry: PrefEntry): Prefs {
  const has = prefs.favorites.some((f) => entryKey(f.target) === entryKey(entry.target));
  return {
    ...prefs,
    favorites: has
      ? prefs.favorites.filter((f) => entryKey(f.target) !== entryKey(entry.target))
      : [entry, ...prefs.favorites].slice(0, 200),
  };
}
