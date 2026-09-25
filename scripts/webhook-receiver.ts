// Local demo webhook receiver with HMAC-SHA256 signature verification.
// Usage: npx tsx scripts/webhook-receiver.ts [port] [secret]
import http from "node:http";
import { createHmac } from "node:crypto";

const port = Number(process.argv[2] ?? 3999);
const secret = process.argv[3] ?? "";

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const sig = (req.headers["x-raptorforge-signature"] as string) ?? "";
      const ts = JSON.parse(body || "{}")?.timestamp ?? "";
      const expected = secret
        ? `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`
        : sig;
      const valid = sig === expected;
      console.log(`[${new Date().toISOString()}] ${req.headers["x-raptorforge-event"] ?? "?"} signature_ok=${valid}`);
      console.log(body);
      res.writeHead(200);
      res.end("ok");
    });
  })
  .listen(port, () => console.log(`webhook receiver listening on :${port}`));
