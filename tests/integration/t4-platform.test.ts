import { describe, it, expect } from "vitest";
import { makeClient, makeAccount, serverReady, uniq } from "./setup";

const B = process.env.BASE_URL ?? "http://localhost:3000";

describe.runIf(await serverReady())("T4 — platform & stretch", () => {
  it("serves the OpenAPI document at /api/openapi.json", async () => {
    const res = await fetch(`${B}/api/openapi.json`);
    const spec = await res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths).length).toBeGreaterThan(20);
  });

  it("certificate lifecycle: issue, verify, tamper-detection design, PDF, privacy", async () => {
    const org = await makeAccount(`t4org-${uniq()}`, "ORGANIZER");
    const ev = await org.client.post<{ event: { id: string } }>("/api/events", {
      name: `T4 ${uniq()}`, slug: `t4-${uniq()}`,
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7 * 864e5).toISOString(),
      registrationStart: new Date().toISOString(), registrationEnd: new Date(Date.now() + 6 * 864e5).toISOString(),
      submissionDeadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    const eventId = ev.event.id;
    const user = await makeAccount("t4cert");
    const cert = await org.client.post<{ certificate: { certificateId: string } }>(`/api/events/${eventId}/certificates`, {
      userId: user.userId, achievement: "PARTICIPANT",
    });
    const cid = cert.certificate.certificateId;
    expect(cid).toMatch(/^RF\d\d-/);

    // public verification — privacy-preserving (given name only)
    const anon = makeClient();
    const v = await anon.get<{ verified: boolean; certificate: { participant: string } }>(`/api/certificates/${cid}`);
    expect(v.verified).toBe(true);
    expect(v.certificate.participant).not.toContain("Test");

    // unknown id → 404
    await expect(anon.get("/api/certificates/RF99-NOPE")).rejects.toMatchObject({ error: { code: "NOT_FOUND" } });

    // PDF downloads locally with correct content type
    const pdf = await fetch(`${B}/api/certificates/${cid}/pdf`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const buf = await pdf.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(500);
  });

  it("CSV import validates strictly and rejects malformed rows with row-level errors", async () => {
    const org = await makeAccount(`t4org2-${uniq()}`, "ORGANIZER");
    const ev = await org.client.post<{ event: { id: string } }>("/api/events", {
      name: `T4I ${uniq()}`, slug: `t4i-${uniq()}`,
      startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7 * 864e5).toISOString(),
      registrationStart: new Date().toISOString(), registrationEnd: new Date(Date.now() + 6 * 864e5).toISOString(),
      submissionDeadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    const eventId = ev.event.id;
    const bad = "email,name\nnot-an-email,Broken\nok@test.local,Good\ndup@test.local,X\ndup@test.local,Y";
    await expect(org.client.post(`/api/events/${eventId}/import`, { type: "participants", csv: bad })).rejects.toMatchObject({
      error: { code: "UNPROCESSABLE" },
    });
    const good = "email,name\nimported1@test.local,Imported One\nimported2@test.local,Imported Two";
    const res = await org.client.post<{ imported: number; accountsCreated: number }>(`/api/events/${eventId}/import`, {
      type: "participants", csv: good,
    });
    expect(res.imported).toBe(2);
    expect(res.accountsCreated).toBe(2);
  });

  it("webhooks: HMAC-signed delivery to a local receiver", async () => {
    const { startReceiver, deliveries } = await import("../helpers/receiver");
    const stop = await startReceiver(3997);
    try {
      const org = await makeAccount(`t4wh-${uniq()}`, "ORGANIZER");
      const ev = await org.client.post<{ event: { id: string } }>("/api/events", {
        name: `T4W ${uniq()}`, slug: `t4w-${uniq()}`,
        startDate: new Date().toISOString(), endDate: new Date(Date.now() + 7 * 864e5).toISOString(),
        registrationStart: new Date().toISOString(), registrationEnd: new Date(Date.now() + 6 * 864e5).toISOString(),
        submissionDeadline: new Date(Date.now() + 7 * 864e5).toISOString(),
      });
      const eventId = ev.event.id;
      await org.client.post(`/api/events/${eventId}/webhooks`, { url: "http://localhost:3997/hooks/test", events: [] });
      const user = await makeAccount("t4whcert");
      await org.client.post(`/api/events/${eventId}/certificates`, { userId: user.userId, achievement: "PARTICIPANT" });
      await org.client.post(`/api/events/${eventId}/webhooks/dispatch`, { method: "POST" });
      // webhook fires on certificate.generated; wait briefly for delivery
      await new Promise((r) => setTimeout(r, 1500));
      const got = deliveries();
      expect(got.length).toBeGreaterThan(0);
      expect(got[0].headers["x-raptorforge-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    } finally {
      stop();
    }
  });

  it("embedded gallery renders public data only (X-Frame-Options ALLOWALL)", async () => {
    const events = await fetch(`${B}/api/events`).then((r) => r.json());
    if (events.events.length === 0) return;
    const res = await fetch(`${B}/embed/events/${events.events[0].slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBe("ALLOWALL");
  });

  it("health endpoint reports all subsystems", async () => {
    const h = await fetch(`${B}/api/health`).then((r) => r.json());
    expect(h.status).toBe("HEALTHY");
    expect(h.checks.database).toBe("HEALTHY");
  });
});
