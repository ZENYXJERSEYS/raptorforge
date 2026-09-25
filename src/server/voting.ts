import { prisma } from "@/server/db";
import { Errors } from "@/server/errors";
import { enforceRateLimit } from "@/server/ratelimit";
import { hashIp, seededShuffle } from "@/server/util";
import { audit } from "@/server/audit";

/**
 * Community voting (T3): configured windows/quotas, server-enforced, with
 * integrity heuristics that FLAG (never auto-accuse) and full audit trail.
 */

export interface VotingWindow {
  votingEnabled: boolean;
  votingStart: Date | null;
  votingEnd: Date | null;
  votesPerUser: number;
}

export function votingOpen(v: VotingWindow, now = new Date()): boolean {
  if (!v.votingEnabled) return false;
  if (v.votingStart && now < v.votingStart) return false;
  if (v.votingEnd && now > v.votingEnd) return false;
  return true;
}

export interface CastVoteInput {
  userId: string;
  eventId: string;
  projectId: string;
  ip: string | null;
  userAgent: string | null;
}

export async function castVote(input: CastVoteInput) {
  const event = await prisma.event.findUnique({ where: { id: input.eventId } });
  if (!event) throw Errors.notFound("Event not found.");
  if (!votingOpen(event)) {
    throw Errors.forbidden("Voting is not open for this event.");
  }

  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project || project.eventId !== input.eventId) throw Errors.notFound("Project not found.");
  if (project.status === "DRAFT" || project.status === "DISQUALIFIED") {
    throw Errors.forbidden("This project cannot receive votes.");
  }

  // one vote per user per project (DB constraint backs this up)
  const existing = await prisma.vote.findUnique({
    where: { userId_projectId: { userId: input.userId, projectId: input.projectId } },
  });
  if (existing) throw Errors.conflict("You have already voted for this project.");

  // per-user quota
  const used = await prisma.vote.count({ where: { eventId: input.eventId, userId: input.userId } });
  if (used >= event.votesPerUser) {
    throw Errors.forbidden(`Vote quota reached (${event.votesPerUser} votes per user).`);
  }

  // rate limit: max 10 votes per user per 60s
  await enforceRateLimit(`vote:${input.userId}`, 10, 60_000);

  // velocity heuristic: votes by this user in the last 60s (before this one)
  const recent = await prisma.vote.count({
    where: { userId: input.userId, createdAt: { gte: new Date(Date.now() - 60_000) } },
  });

  const ipHash = hashIp(input.ip);
  // duplicate-velocity across IPs: same IP casting many votes in 5 min
  const ipRecent = ipHash
    ? await prisma.vote.count({
        where: { ipHash, createdAt: { gte: new Date(Date.now() - 5 * 60_000) } },
      })
    : 0;

  let flagLevel: "NORMAL" | "SUSPICIOUS" | "CRITICAL" = "NORMAL";
  let flagReason: string | null = null;
  if (recent >= 10 || ipRecent >= 25) {
    flagLevel = "CRITICAL";
    flagReason = `velocity: ${recent} votes/60s by user, ${ipRecent} votes/5min from same IP hash`;
  } else if (recent >= 5 || ipRecent >= 12) {
    flagLevel = "SUSPICIOUS";
    flagReason = `velocity: ${recent} votes/60s by user, ${ipRecent} votes/5min from same IP hash`;
  }

  const vote = await prisma.$transaction(async (tx) => {
    const v = await tx.vote.create({
      data: {
        eventId: input.eventId,
        projectId: input.projectId,
        userId: input.userId,
        ipHash,
        userAgent: input.userAgent?.slice(0, 200) ?? null,
        flagLevel,
        flagReason,
      },
    });
    await audit(
      {
        actorId: input.userId,
        action: "VOTE_CAST",
        resource: "project",
        resourceId: input.projectId,
        metadata: { voteId: v.id, flagLevel },
      },
      tx
    );
    if (flagLevel !== "NORMAL") {
      await audit(
        {
          actorId: input.userId,
          action: "VOTE_FLAGGED",
          resource: "vote",
          resourceId: v.id,
          metadata: { flagLevel, flagReason },
        },
        tx
      );
    }
    return v;
  });

  return vote;
}

/** Public vote counts are hidden while configured; organizers always see truth. */
export async function publicVoteCountsVisible(eventId: string): Promise<boolean> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return false;
  if (!event.votingResultsHidden) return true;
  return !votingOpen(event);
}

/** Server-side randomized project ordering for voting (per user, reproducible). */
export async function randomizedProjectOrder(
  eventId: string,
  userId: string
): Promise<string[]> {
  const projects = await prisma.project.findMany({
    where: { eventId, status: { in: ["SUBMITTED", "LOCKED"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event?.randomizedOrdering) return projects.map((p) => p.id);
  // seed from event + user; stable per user per hour window so refreshes don't reshuffle mid-session
  const hourBucket = Math.floor(Date.now() / 3_600_000);
  const seedBase = `${eventId}:${userId}:${hourBucket}`;
  let seed = 2166136261;
  for (const ch of seedBase) {
    seed ^= ch.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return seededShuffle(projects.map((p) => p.id), seed >>> 0);
}
