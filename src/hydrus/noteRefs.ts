export interface HydrusRef {
  label: string;
  hash: string;
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
