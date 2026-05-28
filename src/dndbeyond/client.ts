import { requestUrl } from "obsidian";
import type {
  DdbCobaltTokenResponse,
  DdbEncounterSummary,
  DdbEncounter,
  DdbCharacterSummary,
} from "./types";

const AUTH_URL = "https://auth-service.dndbeyond.com/v1/cobalt-token";
const ENCOUNTER_URL = "https://encounter-service.dndbeyond.com/v1/encounters";
const CHARACTER_URL = "https://character-service.dndbeyond.com/character/v5/character";

export class DdbClient {
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(private cobaltSession: string) {
    if (!cobaltSession) throw new Error("CobaltSession cookie is required");
  }

  async validateSession(): Promise<boolean> {
    try {
      await this.refreshToken();
      return true;
    } catch {
      return false;
    }
  }

  async getEncounters(): Promise<DdbEncounter[]> {
    const res = await this.authedGet(`${ENCOUNTER_URL}?skip=0&take=100`);
    const body = res.json as { data?: Record<string, unknown>[] } | Record<string, unknown>[];
    const raw = Array.isArray(body) ? body : (body.data ?? []);
    return raw.map((e) => this.parseEncounter(e));
  }

  async getEncounter(id: string): Promise<DdbEncounter> {
    const res = await this.authedGet(`${ENCOUNTER_URL}/${id}`);
    const body = res.json as Record<string, unknown>;
    const enc = body.data ? (body.data as Record<string, unknown>) : body;
    if (!enc.id) throw new Error("Invalid encounter response");
    return this.parseEncounter(enc);
  }

  private parseEncounter(raw: Record<string, unknown>): DdbEncounter {
    const monsters = Array.isArray(raw.monsters) ? raw.monsters : [];
    const players = Array.isArray(raw.players) ? raw.players : [];
    return {
      id: raw.id as string,
      name: (raw.name as string) ?? "Unnamed",
      inProgress: (raw.inProgress as boolean) ?? false,
      roundNum: (raw.roundNum as number) ?? 0,
      turnNum: (raw.turnNum as number) ?? 0,
      monsters: monsters.map((m: Record<string, unknown>) => ({
        id: (m.id as number) ?? 0,
        name: (m.name as string) ?? "Unknown",
        initiative: (m.initiative as number) ?? 0,
        currentHitPoints: (m.currentHitPoints as number) ?? 0,
        maximumHitPoints: (m.maximumHitPoints as number) ?? 0,
        uniqueId: (m.uniqueId as string) ?? "",
      })),
      players: players
        .filter((p: Record<string, unknown>) => p.type !== "CHARACTER_TYPE_ABSTRACT")
        .map((p: Record<string, unknown>) => ({
          id: this.parsePlayerId(p.id),
          name: (p.name as string) ?? (p.userName as string) ?? "Unknown",
          initiative: (p.initiative as number) ?? 0,
        })),
    };
  }

  private parsePlayerId(id: unknown): number {
    if (typeof id === "number") return id;
    if (typeof id === "string") {
      const n = parseInt(id, 10);
      return isNaN(n) ? 0 : n;
    }
    return 0;
  }

  async getCharacter(characterId: number): Promise<DdbCharacterSummary> {
    const res = await this.authedGet(`${CHARACTER_URL}/${characterId}`);
    const body = res.json as { data?: Record<string, unknown> };
    const data = body.data ?? (body as unknown as Record<string, unknown>);

    const baseHp = (data.baseHitPoints as number) ?? 0;
    const bonusHp = (data.bonusHitPoints as number) ?? 0;
    const removedHp = (data.removedHitPoints as number) ?? 0;
    const tempHp = (data.temporaryHitPoints as number) ?? 0;
    const overrideHp = data.overrideHitPoints as number | null;

    const maxHp = overrideHp != null ? overrideHp : baseHp + bonusHp;
    const currentHp = maxHp - removedHp;

    return {
      id: characterId,
      name: (data.name as string) ?? "Unknown",
      currentHitPoints: currentHp,
      maxHitPoints: maxHp,
      temporaryHitPoints: tempHp,
    };
  }

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry - 30000) {
      return this.token;
    }
    await this.refreshToken();
    return this.token!;
  }

  private async refreshToken(): Promise<void> {
    const res = await requestUrl({
      url: AUTH_URL,
      method: "POST",
      headers: {
        Cookie: `CobaltSession=${this.cobaltSession}`,
        "Content-Type": "application/json",
      },
      body: "",
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      this.token = null;
      this.tokenExpiry = 0;
      throw new Error(`DDB auth failed (${res.status})`);
    }
    const data = res.json as DdbCobaltTokenResponse;
    if (!data.token) throw new Error("DDB auth response missing token");
    this.token = data.token;
    this.tokenExpiry = Date.now() + data.ttl * 1000;
  }

  private async authedGet(url: string) {
    const token = await this.ensureToken();
    const res = await requestUrl({
      url,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      throw: false,
    });
    if (res.status === 401) {
      this.token = null;
      this.tokenExpiry = 0;
      throw new Error("DDB session expired");
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`DDB request failed (${res.status}): ${url}`);
    }
    return res;
  }
}
