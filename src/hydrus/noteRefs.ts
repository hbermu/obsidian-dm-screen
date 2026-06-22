import type { HydrusCache, CachedEntry } from "./cache";
import type { HydrusClient, HydrusFile } from "./client";
import { mediaTypeOf } from "./client";
import { debug, debugWarn } from "../debug";

export interface HydrusRef {
  label: string;
  hash: string;
}

export interface ResolvedHydrusRef extends HydrusRef {
  mediaType: "image" | "video" | null;
  cached: boolean;
  available: boolean;
}

const REF_RE = /\[([^\]]*)\]\(hydrus:\/\/([0-9a-fA-F]{64})\)/g;

export function parseHydrusRefs(noteBody: string): HydrusRef[] {
  const seen = new Set<string>();
  const refs: HydrusRef[] = [];
  for (const m of noteBody.matchAll(REF_RE)) {
    const hash = m[2].toLowerCase();
    if (seen.has(hash)) continue;
    seen.add(hash);
    refs.push({ label: m[1], hash });
  }
  return refs;
}

export async function resolveHydrusRefs(
  refs: HydrusRef[],
  cache: HydrusCache,
  client: HydrusClient | null
): Promise<ResolvedHydrusRef[]> {
  const entries = await Promise.all(refs.map((r) => cache.get(r.hash)));
  const missing = refs.filter((_, i) => !entries[i]).map((r) => r.hash);

  const remote: Record<string, HydrusFile> = {};
  if (missing.length > 0 && client) {
    try {
      const files = await client.getFileMetadata(missing);
      for (const f of files) remote[f.hash] = f;
    } catch (err) {
      debugWarn("resolveHydrusRefs: metadata fetch failed", (err as Error).message);
    }
  }

  return refs.map((ref, i) => {
    const entry = entries[i];
    if (entry) {
      return { ...ref, mediaType: mediaTypeOf(entry.mime), cached: true, available: true };
    }
    const file = remote[ref.hash];
    if (file) {
      return { ...ref, mediaType: mediaTypeOf(file.mime), cached: false, available: true };
    }
    debug("resolveHydrusRefs: unresolved", ref.hash.slice(0, 12));
    return { ...ref, mediaType: null, cached: false, available: false };
  });
}

export async function ensureLocalCopy(
  ref: ResolvedHydrusRef,
  cache: HydrusCache,
  client: HydrusClient | null
): Promise<CachedEntry> {
  const existing = await cache.get(ref.hash);
  if (existing) return existing;
  if (!client) throw new Error("Hydrus is offline; this reference is not cached.");
  const files = await client.getFileMetadata([ref.hash]);
  const file = files[0];
  if (!file) throw new Error("Hydrus could not find this reference.");
  const { entry } = await cache.fetchAndCache(client, file);
  return entry;
}
