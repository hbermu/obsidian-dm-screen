import { requestUrl } from "obsidian";
import type { RequestUrlResponse } from "obsidian";
import { debug, debugError } from "../debug";

export interface HydrusClientOptions {
  baseUrl: string;
  apiKey: string;
}

export interface HydrusFile {
  hash: string;
  mime: string;
  ext: string;
  width?: number;
  height?: number;
  size: number;
  knownTags: string[];
}

export interface HydrusService {
  name: string;
  type: number;
  service_key: string;
}

export interface HydrusAccessInfo {
  basic_permissions: number[];
  human_description: string;
}

export interface HydrusTagSuggestion {
  value: string;
  count?: number;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/apng": "apng",
  "image/avif": "avif",
  "image/x-icon": "ico",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
};

export function extFromMime(mime: string): string {
  return MIME_TO_EXT[mime.toLowerCase()] ?? "bin";
}

export function mediaTypeOf(mime: string): "image" | "video" {
  return mime.toLowerCase().startsWith("video/") ? "video" : "image";
}

export class HydrusClient {
  constructor(private opts: HydrusClientOptions) {
    if (!opts.baseUrl) throw new Error("hydrus baseUrl is required");
    if (!opts.apiKey) throw new Error("hydrus apiKey is required");
  }

  async verifyAccess(): Promise<HydrusAccessInfo> {
    debug("Hydrus: verifyAccess");
    const res = await this.get("/verify_access_key");
    return res.json as HydrusAccessInfo;
  }

  async getServices(): Promise<HydrusService[]> {
    const res = await this.get("/get_services");
    const body = res.json as Record<string, unknown>;
    // Prefer services_v2 (array with service_key on each object)
    if (Array.isArray(body.services_v2)) {
      return (body.services_v2 as Record<string, unknown>[])
        .filter((s) => s.name && s.service_key)
        .map((s) => ({
          name: s.name as string,
          service_key: s.service_key as string,
          type: typeof s.type === "number" ? s.type : -1,
        }));
    }
    // Fallback: legacy dict where key = service_key
    if (body.services && typeof body.services === "object" && !Array.isArray(body.services)) {
      return Object.entries(body.services as Record<string, Record<string, unknown>>).map(
        ([key, svc]) => ({
          name: (svc.name as string) ?? "",
          service_key: key,
          type: typeof svc.type === "number" ? svc.type : -1,
        })
      );
    }
    return [];
  }

  async searchFiles(tags: string[], limit?: number): Promise<{ hashes: string[] }> {
    const effective = limit && limit > 0 ? [...tags, `system:limit=${limit}`] : tags;
    debug("Hydrus: searchFiles tags=", effective);
    const qs = new URLSearchParams({
      tags: JSON.stringify(effective),
      return_hashes: "true",
      return_file_ids: "false",
    });
    const res = await this.get(`/get_files/search_files?${qs.toString()}`);
    const body = res.json as { hashes?: string[] };
    debug("Hydrus: searchFiles returned", body.hashes?.length ?? 0, "hashes");
    return { hashes: body.hashes ?? [] };
  }

  async searchTags(
    prefix: string,
    opts?: { tagServiceKey?: string; limit?: number }
  ): Promise<HydrusTagSuggestion[]> {
    const qs = new URLSearchParams({ search: prefix });
    if (opts?.tagServiceKey) qs.set("tag_service_key", opts.tagServiceKey);
    const res = await this.get(`/add_tags/search_tags?${qs.toString()}`);
    const body = res.json as { tags?: HydrusTagSuggestion[] };
    const list = Array.isArray(body.tags) ? body.tags : [];
    const limit = opts?.limit ?? 50;
    return limit > 0 ? list.slice(0, limit) : list;
  }

  async getFileMetadata(hashes: string[], tagService?: string): Promise<HydrusFile[]> {
    if (hashes.length === 0) return [];
    debug("Hydrus: getFileMetadata for", hashes.length, "hashes");
    const qs = new URLSearchParams({
      hashes: JSON.stringify(hashes),
      include_mimes: "true",
      include_sizes: "true",
      include_known_urls: "false",
      include_notes: "false",
    });
    const res = await this.get(`/get_files/file_metadata?${qs.toString()}`);
    const body = res.json as { metadata?: HydrusMetadataRow[] };
    const files = (body.metadata ?? []).map((row) => ({
      hash: row.hash,
      mime: row.mime ?? "application/octet-stream",
      ext: row.ext?.replace(/^\./, "") || extFromMime(row.mime ?? ""),
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      size: row.size ?? 0,
      knownTags: extractKnownTags(row, tagService),
    }));
    debug("Hydrus: getFileMetadata returned", files.length, "files");
    return files;
  }

  async getFileBytes(hash: string): Promise<ArrayBuffer> {
    const res = await this.get(`/get_files/file?hash=${encodeURIComponent(hash)}`);
    return res.arrayBuffer;
  }

  async getThumbnailBytes(hash: string): Promise<ArrayBuffer> {
    const res = await this.get(`/get_files/thumbnail?hash=${encodeURIComponent(hash)}`);
    return res.arrayBuffer;
  }

  private async get(path: string): Promise<RequestUrlResponse> {
    const url = `${this.opts.baseUrl}${path}`;
    const res = await requestUrl({
      url,
      method: "GET",
      headers: {
        "Hydrus-Client-API-Access-Key": this.opts.apiKey,
        Accept: "application/json",
      },
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      const detail = res.text?.slice(0, 200) ?? "";
      debugError("Hydrus HTTP error:", res.status, path, detail);
      throw new Error(`Hydrus ${res.status} on ${path}: ${detail}`);
    }
    return res;
  }
}

interface HydrusMetadataRow {
  hash: string;
  mime?: string;
  ext?: string;
  width?: number;
  height?: number;
  size?: number;
  tags?: Record<string, {
    name?: string;
    type?: number;
    storage_tags?: Record<string, string[]>;
    display_tags?: Record<string, string[]>;
  }>;
}

// Why: Hydrus storage_tags is keyed by status — "0" active, "1" pending, "2" deleted
// tombstone, "3" petitioned. Tombstones are retained server-side to block re-import
// from "parse tags from filename" rules; surfacing them here would leak deleted tags
// into the explorer tile menu, tooltip, layer label, Copy tags, and the local filter.
function extractKnownTags(row: HydrusMetadataRow, tagService?: string): string[] {
  if (!row.tags) return [];
  if (tagService) {
    for (const svc of Object.values(row.tags)) {
      if (svc?.name === tagService) {
        return [...(svc.storage_tags?.["0"] ?? [])];
      }
    }
  }
  const active = new Set<string>();
  for (const svc of Object.values(row.tags)) {
    for (const tag of svc?.storage_tags?.["0"] ?? []) active.add(tag);
  }
  return [...active];
}
