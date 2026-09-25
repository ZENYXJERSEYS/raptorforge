import http from "node:http";

let captured: { body: string; headers: Record<string, string> }[] = [];

export function deliveries() {
  return captured;
}

export function startReceiver(port: number): Promise<() => void> {
  captured = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = String(v);
      captured.push({ body, headers });
      res.writeHead(200);
      res.end("ok");
    });
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve(() => server.close()));
  });
}
