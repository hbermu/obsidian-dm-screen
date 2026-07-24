import WebSocket from "ws";

export interface WsMessage {
  type: string;
  payload: Record<string, unknown>;
}

type Predicate = (m: WsMessage) => boolean;

export class WsRecorder {
  readonly messages: WsMessage[] = [];
  private ws: WebSocket;
  private opened: Promise<void>;

  private constructor(port: number, channel: "player" | "map") {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}${channel === "map" ? "/map" : "/"}`);
    this.ws.on("message", (data) => this.messages.push(JSON.parse(data.toString()) as WsMessage));
    this.opened = new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  static async connect(port: number, channel: "player" | "map"): Promise<WsRecorder> {
    const rec = new WsRecorder(port, channel);
    await rec.opened;
    return rec;
  }

  count(type: string): number {
    return this.messages.filter((m) => m.type === type).length;
  }

  // `skip` ignores the first N messages of the type (e.g. "the second map-fog");
  // `where` matches on payload — needed because panel republish can emit an
  // empty sync before the interesting one, so counts alone are unreliable.
  async waitFor(
    type: string,
    opts: { timeout?: number; skip?: number; where?: Predicate } = {},
  ): Promise<WsMessage> {
    const { timeout = 10_000, skip = 0, where = () => true } = opts;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const hit = this.messages.filter((m) => m.type === type).slice(skip).find(where);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    const seen = this.messages.map((m) => m.type).join(", ") || "none";
    throw new Error(`no matching '${type}' within ${timeout}ms (saw: ${seen})`);
  }

  close(): void {
    this.ws.close();
  }
}
