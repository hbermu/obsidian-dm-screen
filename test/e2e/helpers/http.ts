import * as http from "node:http";

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

// Plain node:http with agent:false — every request opens and closes its own
// socket. Global fetch (undici) pools keep-alive connections, and on the old
// Electron/Node 18 runtimes of Obsidian <=1.5.x a pooled idle socket keeps the
// previous port bound across a server stop/start (see the stop() issue).
export function httpGet(url: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on("error", reject);
  });
}
