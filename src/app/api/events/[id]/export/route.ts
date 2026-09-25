import { prisma } from "@/server/db";
import { requireEventOrganizer } from "@/server/auth/rbac";
import { Errors } from "@/server/errors";
import { audit } from "@/server/audit";
import { handler, ok } from "@/server/api";
import { toCsv } from "@/server/util";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx) => {
  const { id } = await (ctx as Ctx).params;
  const { user } = await requireEventOrganizer(req, id);
  const what = req.nextUrl.searchParams.get("what") ?? "projects";

  async function csv(what: string): Promise<{ filename: string; body: string }> {
    switch (what) {
      case "participants": {
        const rows = await prisma.teamMember.findMany({
          where: { team: { eventId: id } },
          include: { user: true, team: true },
        });
        return {
          filename: "participants.csv",
          body: toCsv(
            ["userId", "email", "name", "team", "role", "joinedAt"],
            rows.map((r) => [r.userId, r.user.email, r.user.name, r.team.name, r.role, r.joinedAt.toISOString()])
          ),
        };
      }
      case "teams": {
        const rows = await prisma.team.findMany({
          where: { eventId: id },
          include: { members: { include: { user: true } }, _count: { select: { projects: true } } },
        });
        return {
          filename: "teams.csv",
          body: toCsv(
            ["teamId", "name", "owner", "memberCount", "hasProject"],
            rows.map((t) => [t.id, t.name, t.ownerId, t.members.length, t._count.projects > 0])
          ),
        };
      }
      case "judges": {
        const judges = await prisma.judge.findMany({
          where: { eventId: id },
          include: { user: true, assignments: true },
        });
        const completed = await prisma.judgement.groupBy({ by: ["judgeId"], where: { project: { eventId: id } }, _count: { id: true } });
        const cmap = new Map(completed.map((c) => [c.judgeId, c._count.id]));
        return {
          filename: "judges.csv",
          body: toCsv(
            ["judgeId", "name", "email", "status", "expertise", "assigned", "completed"],
            judges.map((j) => [j.id, j.user.name, j.user.email, j.status, j.expertise.join("|"), j.assignments.length, cmap.get(j.id) ?? 0])
          ),
        };
      }
      case "assignments": {
        const rows = await prisma.judgeAssignment.findMany({
          where: { project: { eventId: id } },
          include: { judge: { include: { user: true } }, project: true },
        });
        return {
          filename: "assignments.csv",
          body: toCsv(
            ["judgeId", "judgeName", "projectId", "projectName", "reason", "createdAt"],
            rows.map((a) => [a.judge.id, a.judge.user.name, a.project.id, a.project.name, a.reason, a.createdAt.toISOString()])
          ),
        };
      }
      case "scores": {
        const judgements = await prisma.judgement.findMany({
          where: { project: { eventId: id } },
          include: { scores: true, judge: { include: { user: true } }, project: true },
        });
        const criteria = await prisma.rubricCriterion.findMany({ where: { rubric: { eventId: id } } });
        const cById = new Map(criteria.map((c) => [c.id, c.name]));
        const rows: unknown[][] = [];
        for (const j of judgements) {
          for (const s of j.scores) {
            rows.push([j.judge.user.name, j.project.name, cById.get(s.criterionId) ?? s.criterionId, s.value, j.weightedScore ?? "", j.updatedAt.toISOString()]);
          }
        }
        return {
          filename: "scores.csv",
          body: toCsv(["judge", "project", "criterion", "value", "weightedScore", "updatedAt"], rows),
        };
      }
      case "normalized-scores": {
        const { normalizeScores } = await import("@/server/judging/normalization");
        const judgements = await prisma.judgement.findMany({
          where: { project: { eventId: id } },
          select: { judgeId: true, projectId: true, weightedScore: true },
        });
        const raw = (judgements.filter((j) => j.weightedScore != null) as { judgeId: string; projectId: string; weightedScore: number }[]).map((j) => ({ judgeId: j.judgeId, projectId: j.projectId, score: j.weightedScore }));
        const norm = normalizeScores(raw);
        return {
          filename: "normalized-scores.csv",
          body: toCsv(
            ["judgeId", "projectId", "raw", "normalized", "note"],
            norm.scores.map((s) => [s.judgeId, s.projectId, s.score, s.normalized ?? "", s.note ?? ""])
          ),
        };
      }
      case "votes": {
        const votes = await prisma.vote.findMany({
          where: { eventId: id },
          include: { user: true, project: true },
        });
        return {
          filename: "votes.csv",
          body: toCsv(
            ["userId", "email", "project", "flagLevel", "flagReason", "createdAt"],
            votes.map((v) => [v.userId, v.user.email, v.project.name, v.flagLevel, v.flagReason ?? "", v.createdAt.toISOString()])
          ),
        };
      }
      case "audit": {
        const entries = await prisma.auditLog.findMany({ where: { resourceId: id }, orderBy: { createdAt: "desc" }, take: 5000 });
        return {
          filename: "audit.csv",
          body: toCsv(
            ["id", "actorId", "action", "resource", "resourceId", "metadata", "createdAt"],
            entries.map((e) => [e.id, e.actorId ?? "", e.action, e.resource, e.resourceId ?? "", JSON.stringify(e.metadata), e.createdAt.toISOString()])
          ),
        };
      }
      case "results": {
        const res = await prisma.eventResult.findFirst({ where: { eventId: id }, orderBy: { createdAt: "desc" } });
        if (!res) throw Errors.notFound("No results generated yet.");
        const payload = res.payloadJson as { projects?: { name: string; teamName: string; trackName: string | null; n: number; rawMean: number | null; normalizedMean: number | null; rawRank: number | null; normalizedRank: number | null }[] };
        const rows = (payload.projects ?? []).map((p) => [p.name, p.teamName, p.trackName ?? "", p.n, p.rawMean ?? "", p.normalizedMean ?? "", p.rawRank ?? "", p.normalizedRank ?? ""]);
        return {
          filename: "results.csv",
          body: toCsv(["project", "team", "track", "n", "rawMean", "normalizedMean", "rawRank", "normalizedRank"], rows),
        };
      }
      case "projects":
      default: {
        const rows = await prisma.project.findMany({
          where: { eventId: id },
          include: { team: true, track: true },
        });
        return {
          filename: "projects.csv",
          body: toCsv(
            ["projectId", "name", "team", "track", "status", "technologies", "repo", "demo", "submittedAt"],
            rows.map((p) => [p.id, p.name, p.team.name, p.track?.name ?? "", p.status, p.technologies.join("|"), p.repositoryUrl ?? "", p.demoUrl ?? "", p.submittedAt?.toISOString() ?? ""])
          ),
        };
      }
    }
  }

  const { filename, body } = await csv(what);
  await audit({ actorId: user.id, action: "CSV_EXPORTED", resource: "event", resourceId: id, metadata: { what } });
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
