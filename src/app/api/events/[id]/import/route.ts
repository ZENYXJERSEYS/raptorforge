import { z } from "zod";
import { prisma } from "@/server/db";
import { requireEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, parseBody, ok } from "@/server/api";
import { parseCsv } from "@/server/util";
import { hashPassword } from "@/server/auth/password";
import { slugify } from "@/server/util";

type Ctx = { params: Promise<{ id: string }> };

const importSchema = z.object({
  type: z.enum(["participants", "projects"]),
  csv: z.string().min(1).max(2_000_000),
  createAccounts: z.boolean().default(true),
});

const emailSchema = z.string().email();

export const POST = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const body = await parseBody(req, importSchema);

  const rows = parseCsv(body.csv);
  if (rows.length < 2) throw Errors.badRequest("CSV needs a header row and at least one data row.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const dataRows = rows.slice(1);

  const errors: { row: number; message: string }[] = [];
  const parsed: Record<string, string>[] = [];
  dataRows.forEach((row, i) => {
    if (row.length === 1 && row[0].trim() === "") return;
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => (obj[h] = (row[idx] ?? "").trim()));
    parsed.push(obj);
    void i;
  });

  if (body.type === "participants") {
    if (!header.includes("email") || !header.includes("name")) {
      throw Errors.badRequest("participants.csv requires columns: email,name");
    }
    const seen = new Set<string>();
    for (const [i, row] of parsed.entries()) {
      const line = i + 2;
      if (!emailSchema.safeParse(row.email).success) {
        errors.push({ row: line, message: `invalid email "${row.email}"` });
        continue;
      }
      if (!row.name) errors.push({ row: line, message: "missing name" });
      if (seen.has(row.email.toLowerCase())) errors.push({ row: line, message: `duplicate email in file: ${row.email}` });
      seen.add(row.email.toLowerCase());
    }
    if (errors.length) {
      throw Errors.unprocessable("Import rejected — fix these rows and re-upload.", { errors });
    }
    const existingUsers = await prisma.user.findMany({ where: { email: { in: [...seen] } } });
    const existingEmails = new Set(existingUsers.map((u) => u.email));
    let created = 0;
    let linked = 0;
    const password = await hashPassword("change-me-on-first-login");
    await prisma.$transaction(async (tx) => {
      for (const row of parsed) {
        const email = row.email.toLowerCase();
        let u = existingEmails.has(email)
          ? existingUsers.find((x) => x.email === email)
          : await tx.user.create({
              data: { email, name: row.name, role: "PARTICIPANT", passwordHash: password },
            });
        if (!u) continue;
        if (!existingEmails.has(email)) created++;
        else linked++;
        // create a placeholder team of one so imported participants are event members
        const teamName = `${row.name}'s team`;
        const team = await tx.team.create({ data: { eventId: id, name: teamName, ownerId: u.id } });
        await tx.teamMember.create({ data: { teamId: team.id, userId: u.id, role: "OWNER" } });
        await tx.auditLog.create({
          data: { actorId: user.id, action: "USER_CREATED", resource: "user", resourceId: u.id, metadata: { via: "csv-import" } },
        });
      }
      await tx.auditLog.create({
        data: { actorId: user.id, action: "CSV_IMPORTED", resource: "event", resourceId: id, metadata: { type: body.type, rows: parsed.length, created, linked } },
      });
    });
    return ok({ imported: parsed.length, accountsCreated: created, accountsLinked: linked }, 201);
  }

  // projects import
  if (!header.includes("team") || !header.includes("name") || !header.includes("track")) {
    throw Errors.badRequest("projects.csv requires columns: team,name,track");
  }
  const teams = await prisma.team.findMany({ where: { eventId: id }, include: { members: true } });
  const teamByName = new Map(teams.map((t) => [t.name.toLowerCase(), t]));
  const tracks = await prisma.track.findMany({ where: { eventId: id } });
  const trackByName = new Map(tracks.map((t) => [t.name.toLowerCase(), t.id]));

  for (const [i, row] of parsed.entries()) {
    const line = i + 2;
    if (!teamByName.has(row.team.toLowerCase())) errors.push({ row: line, message: `unknown team "${row.team}"` });
    if (!row.name) errors.push({ row: line, message: "missing project name" });
    if (!trackByName.has(row.track.toLowerCase())) errors.push({ row: line, message: `unknown track "${row.track}"` });
    const team = teamByName.get(row.team.toLowerCase());
    if (team) {
      const dup = await prisma.project.findUnique({ where: { eventId_teamId: { eventId: id, teamId: team.id } } });
      if (dup) errors.push({ row: line, message: `team "${row.team}" already has a project` });
    }
  }
  if (errors.length) throw Errors.unprocessable("Import rejected — fix these rows and re-upload.", { errors });

  const created: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const row of parsed) {
      const team = teamByName.get(row.team.toLowerCase())!;
      const baseSlug = slugify(row.name);
      let slug = baseSlug;
      let n = 2;
      while (await tx.project.findUnique({ where: { eventId_slug: { eventId: id, slug } } })) {
        slug = `${baseSlug}-${n++}`;
      }
      const p = await tx.project.create({
        data: {
          eventId: id,
          teamId: team.id,
          trackId: trackByName.get(row.track.toLowerCase())!,
          name: row.name,
          slug,
          shortDescription: row["shortdescription"] ?? "",
          fullDescription: row["fulldescription"] ?? "",
          repositoryUrl: row["repositoryurl"] || null,
          status: "SUBMITTED",
          submittedAt: new Date(),
          createdById: team.ownerId,
        },
      });
      created.push(p.id);
    }
    await tx.auditLog.create({
      data: { actorId: user.id, action: "CSV_IMPORTED", resource: "event", resourceId: id, metadata: { type: "projects", rows: created.length } },
    });
  });
  return ok({ imported: created.length }, 201);
});
