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

  async getEncounters(): Promise<DdbEncounterSummary[]> {
    const res = await this.authedGet(`${ENCOUNTER_URL}?skip=0&take=100`);
    const body = res.json as { data?: DdbEncounterSummary[] } | DdbEncounterSummary[];
    const list = Array.isArray(body) ? body : (body.data ?? []);
    return list.map((e) => ({
      id: e.id,
      name: e.name,
      inProgress: e.inProgress ?? false,
    }));
  }

  async getEncounter(id: string): Promise<DdbEncounter> {
    const res = await this.authedGet(`${ENCOUNTER_URL}/${id}`);
    return res.json as DdbEncounter;
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
