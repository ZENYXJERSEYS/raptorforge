/* eslint-disable no-console */
import { PrismaClient, Prisma } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { computeWeightedScore } from "../src/server/judging/scoring";

const prisma = new PrismaClient();

// deterministic PRNG (mulberry32) — same seed, same fixture data
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261005);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

export const DEMO_PASSWORD = "raptorforge";

const d = (iso: string) => new Date(iso);

async function main() {
  console.log("seeding raptorforge fixtures…");

  // wipe in FK-safe order
  const tables = [
    "webhookDelivery", "webhookEndpoint", "eventResult", "normalizationRun",
    "certificate", "auditLog", "rateLimitCounter", "comment", "vote",
    "pairwiseComparison", "scoreChange", "criterionScore", "judgement",
    "judgeAssignment", "judge", "rubricCriterion", "rubric", "project",
    "teamInvite", "teamMember", "team", "prize", "track", "eventOrganizer",
    "event", "session", "user",
  ] as const;
  for (const t of tables) {
    await (prisma as unknown as { [k: string]: { deleteMany(): Promise<unknown> } })[t].deleteMany();
  }

  const password = await hashPassword(DEMO_PASSWORD);

  // ── users ──
  const mkUser = (email: string, name: string, role: "PARTICIPANT" | "JUDGE" | "ORGANIZER" | "ADMIN") =>
    prisma.user.create({ data: { email, name, role, passwordHash: password } });

  const admin = await mkUser("admin@example.local", "Ada Admin", "ADMIN");
  const organizer = await mkUser("organizer@example.local", "Ollie Organizer", "ORGANIZER");
  const organizer2 = await mkUser("organizer2@example.local", "Nora Organizer", "ORGANIZER");
  const judgeUser = await mkUser("judge@example.local", "Jia Judge", "JUDGE");
  const participant = await mkUser("participant@example.local", "Pat Participant", "PARTICIPANT");

  const judgeUsers = [
    { u: judgeUser, expertise: ["AI", "machine learning"] },
    { u: await mkUser("judge2@example.local", "Jamal Reyes", "JUDGE"), expertise: ["web", "frontend"] },
    { u: await mkUser("judge3@example.local", "Yuki Tanaka", "JUDGE"), expertise: ["open source", "devtools"] },
    { u: await mkUser("judge4@example.local", "Marta Kovacs", "JUDGE"), expertise: ["hardware", "embedded"] },
    { u: await mkUser("judge5@example.local", "Sam Okafor", "JUDGE"), expertise: ["AI", "web"] },
  ];

  const participantUsers: Awaited<ReturnType<typeof mkUser>>[] = [participant];
  for (let i = 2; i <= 32; i++) {
    participantUsers.push(
      await mkUser(`participant${i}@example.local`, `Participant ${i}`, "PARTICIPANT")
    );
  }
  const suspiciousVoter = await mkUser("suspicious-voter@example.local", "Velma Velocity", "PARTICIPANT");

  // ── event ──
  const event = await prisma.event.create({
    data: {
      name: "Dogfood 2026",
      slug: "dogfood-2026",
      description:
        "The RaptorForge dogfood hackathon — build with the tools that build it. 48 hours, four tracks, one forge.",
      startDate: d("2026-10-05T09:00:00Z"),
      endDate: d("2026-10-07T18:00:00Z"),
      registrationStart: d("2026-09-01T00:00:00Z"),
      registrationEnd: d("2026-09-30T23:59:00Z"),
      submissionDeadline: d("2026-10-07T18:00:00Z"),
      status: "ACTIVE",
      assignmentSeed: 20261005,
      judgesPerProject: 3,
      votingEnabled: true,
      votingStart: d("2026-10-06T12:00:00Z"),
      votingEnd: d("2026-10-08T12:00:00Z"),
      votesPerUser: 3,
      votingResultsHidden: true,
      randomizedOrdering: true,
    },
  });

  await prisma.eventOrganizer.createMany({
    data: [
      { eventId: event.id, userId: organizer.id, assignedBy: admin.id },
      { eventId: event.id, userId: organizer2.id, assignedBy: admin.id },
    ],
  });

  // ── tracks ──
  const trackData = [
    { name: "AI", slug: "ai", description: "Applied machine intelligence." },
    { name: "WEB", slug: "web", description: "Web platforms and experiences." },
    { name: "OPEN SOURCE", slug: "open-source", description: "Tools for the commons." },
    { name: "HARDWARE", slug: "hardware", description: "Bits that touch atoms." },
  ];
  const tracks = [] as { id: string; slug: string }[];
  for (const t of trackData) {
    tracks.push(await prisma.track.create({ data: { ...t, eventId: event.id } }));
  }
  const trackBy = Object.fromEntries(tracks.map((t) => [t.slug, t.id]));

  // ── prizes ──
  await prisma.prize.createMany({
    data: [
      { eventId: event.id, name: "Grand Prize", description: "Best overall project.", amount: 500000, rank: 1, kind: "OVERALL" },
      { eventId: event.id, name: "Runner-up", description: "Second best overall.", amount: 200000, rank: 2, kind: "OVERALL" },
      { eventId: event.id, name: "Best AI Project", description: "Top project in the AI track.", trackId: trackBy["ai"], rank: 3, kind: "TRACK" },
      { eventId: event.id, name: "Best Web Project", description: "Top project in the WEB track.", trackId: trackBy["web"], rank: 4, kind: "TRACK" },
      { eventId: event.id, name: "Community Choice", description: "Voted by participants.", rank: 5, kind: "CUSTOM" },
    ],
  });

  // ── rubric ──
  const rubric = await prisma.rubric.create({
    data: {
      eventId: event.id,
      name: "Dogfood 2026 Main Rubric",
      criteria: {
        create: [
          { name: "Technical Quality", description: "Engineering rigor, architecture, correctness.", weight: 30, minScore: 1, maxScore: 5, order: 1 },
          { name: "Innovation", description: "Novelty of idea and execution.", weight: 25, minScore: 1, maxScore: 5, order: 2 },
          { name: "Impact", description: "Usefulness and reach.", weight: 20, minScore: 1, maxScore: 5, order: 3 },
          { name: "User Experience", description: "Design, usability, polish.", weight: 15, minScore: 1, maxScore: 5, order: 4 },
          { name: "Completeness", description: "End-to-end working demo.", weight: 10, minScore: 1, maxScore: 5, order: 5 },
        ],
      },
    },
    include: { criteria: true },
  });
  const criteria = rubric.criteria;

  // ── teams & projects ──
  const teamNames = [
    "Vector Vandals", "Kernel Panic", "Async Avengers", "Bit Forge", "Null Pointers",
    "Garbage Collectors", "Rubber Duckies", "Sudo Winners", "Heap Heroes", "Segfault Society",
  ];
  const projectIdeas = [
    ["ai", "ForgeLLM", "On-device LLM fine-tuning workbench", ["python", "pytorch", "next.js"]],
    ["web", "ShipFast CI", "Zero-config CI dashboards for small teams", ["typescript", "react", "docker"]],
    ["open-source", "DocDrift", "Docs that refactor themselves when APIs change", ["rust", "ts"]],
    ["hardware", "ThermalSense", "ML thermal anomaly detection for makerspaces", ["c++", "esp32"]],
    ["ai", "PromptForge", "Version control for prompt pipelines", ["typescript", "langchain"]],
    ["web", "HackMap", "Live team progress maps for hackathons", ["next.js", "websockets"]],
    ["open-source", "LicenseHawk", "License compliance scanning at commit time", ["go"]],
    ["ai", "ArgusAnnotate", "Collaborative dataset labeling with active learning", ["python", "react"]],
    ["web", "PaletteOS", "Design-token pipeline for design systems", ["typescript"]],
    ["hardware", "GripForce", "Adaptive prosthetic grip tuning kit", ["c", "arduino"]],
    ["open-source", "TestGhost", "Mutation-testing copilot for OSS repos", ["rust", "ts"]],
    ["ai", "ChordSeeker", "Query-by-humming music search", ["python", "faiss"]],
    ["web", "RallyPay", "Split expenses for hack teams in one link", ["next.js", "stripe-free ledger"]],
    ["open-source", "BuildBench", "Reproducible build environment snapshots", ["nix", "shell"]],
    ["hardware", "PulseBench", "Bench PSU with USB-C PD and telemetry", ["c++"]],
    ["web", "StandupZERO", "Async standups that write themselves", ["typescript", "openai-free summarizer"]],
  ] as const;

  let participantCursor = 0;
  const teams: { id: string; memberUserIds: string[]; name: string }[] = [];
  const projects: { id: string; name: string; trackId: string; teamId: string; memberUserIds: string[]; status: string }[] = [];

  for (let i = 0; i < projectIdeas.length; i++) {
    const [trackSlug, name, shortDesc, techs] = projectIdeas[i];
    const size = i < 8 ? int(2, 4) : int(1, 3);
    const members: string[] = [];
    const teamName = teamNames[i % teamNames.length] + (i >= teamNames.length ? ` II` : "");

    // first team's owner is the demo participant
    const owner = i === 0 ? participant : participantUsers[participantCursor++ % participantUsers.length];
    if (!members.includes(owner.id)) members.push(owner.id);
    while (members.length < size) {
      const m = participantUsers[participantCursor++ % participantUsers.length];
      if (!members.includes(m.id)) members.push(m.id);
    }
    const team = await prisma.team.create({
      data: {
        eventId: event.id,
        name: teamName,
        ownerId: owner.id,
        members: { create: members.map((uid, idx) => ({ userId: uid, role: idx === 0 ? "OWNER" : "MEMBER" })) },
      },
    });
    teams.push({ id: team.id, memberUserIds: members, name: teamName });

    const status = i < 12 ? "SUBMITTED" : i === 12 || i === 13 ? "DRAFT" : "LOCKED";
    const project = await prisma.project.create({
      data: {
        eventId: event.id,
        teamId: team.id,
        trackId: trackBy[trackSlug],
        name: name as string,
        slug: (name as string).toLowerCase(),
        shortDescription: shortDesc as string,
        fullDescription: `${shortDesc}. Built during Dogfood 2026 by team ${teamName}. This project demonstrates the full RaptorForge submission workflow including gallery display, judging, and community voting.`,
        repositoryUrl: `https://github.com/raptorforge-demo/${(name as string).toLowerCase()}`,
        demoUrl: rand() > 0.3 ? `https://demo.example.local/${(name as string).toLowerCase()}` : null,
        technologies: techs as unknown as string[],
        status: status as "DRAFT" | "SUBMITTED" | "LOCKED",
        createdById: owner.id,
        submittedAt: status === "DRAFT" ? null : d("2026-10-06T1" + (i % 8) + ":30:00Z"),
      },
    });
    projects.push({ id: project.id, name: project.name, trackId: project.trackId!, teamId: team.id, memberUserIds: members, status });
  }

  // ── judges ──
  const judgeProfiles: { id: string; userId: string; expertise: string[] }[] = [];
  for (const [i, j] of judgeUsers.entries()) {
    const jp = await prisma.judge.create({
      data: { userId: j.u.id, eventId: event.id, status: "ACTIVE", expertise: j.expertise },
    });
    judgeProfiles.push({ id: jp.id, userId: j.u.id, expertise: j.expertise });
    if (i === 0) {
      // demo judge participates in a team? No — judges stay independent (conflict rules).
    }
  }

  // ── assignments (deterministic engine) ──
  const { computeAssignments } = await import("../src/server/judging/assignment");
  const trackExpertise: Record<string, string[]> = {
    [trackBy["ai"]]: ["ai", "machine learning"],
    [trackBy["web"]]: ["web", "frontend"],
    [trackBy["open-source"]]: ["open source", "devtools"],
    [trackBy["hardware"]]: ["hardware", "embedded"],
  };
  const eligibleProjects = projects.filter((p) => p.status !== "DRAFT");
  const assignment = computeAssignments({
    projects: eligibleProjects.map((p) => ({ id: p.id, teamId: p.teamId, trackId: p.trackId, memberUserIds: p.memberUserIds })),
    judges: judgeProfiles.map((j) => ({ id: j.id, userId: j.userId, expertise: j.expertise, active: true })),
    judgesPerProject: 3,
    trackExpertise,
    seed: 20261005,
  });
  for (const dec of assignment.decisions) {
    await prisma.judgeAssignment.create({ data: { judgeId: dec.judgeId, projectId: dec.projectId, reason: dec.reason } });
  }

  // ── judgements with deliberately divergent judge tendencies ──
  // judge0: lenient (mean ≈ 91), judge1: harsh (mean ≈ 68), judge2: moderate,
  // judge3: moderate sparse, judge4: very few scores (insufficient-data demo)
  const tendency = [
    { base: 91, spread: 4 },
    { base: 68, spread: 5 },
    { base: 80, spread: 6 },
    { base: 82, spread: 7 },
    { base: 78, spread: 5 },
  ];
  const scored: { judgeId: string; projectId: string; score: number }[] = [];
  for (const dec of assignment.decisions) {
    const idx = judgeProfiles.findIndex((j) => j.id === dec.judgeId);
    if (idx === 4 && rand() > 0.25) continue; // judge5 barely reviews
    if (idx === 3 && rand() > 0.7) continue; // judge4 sparse
    const t = tendency[idx];
    const raw = Math.max(1, Math.min(5, Math.round((t.base / 20) + (rand() - 0.5) * (t.spread / 10))));
    const scores = criteria.map((c) => ({
      criterionId: c.id,
      value: Math.max(c.minScore, Math.min(c.maxScore, raw + int(-1, 1))),
    }));
    const weighted = computeWeightedScore(scores, criteria.map((c) => ({ criterionId: c.id, weight: c.weight, minScore: c.minScore, maxScore: c.maxScore })));
    await prisma.$transaction(async (tx) => {
      const judgement = await tx.judgement.create({
        data: { judgeId: dec.judgeId, projectId: dec.projectId, weightedScore: weighted, comment: rand() > 0.6 ? "Strong demo; see notes." : "", rubricVersion: 1 },
      });
      await tx.criterionScore.createMany({
        data: scores.map((s) => ({ judgementId: judgement.id, criterionId: s.criterionId, value: s.value })),
      });
      await tx.scoreChange.createMany({
        data: scores.map((s) => ({ judgementId: judgement.id, criterionId: s.criterionId, oldValue: 0, newValue: s.value, action: "CREATED", actorId: judgeProfiles[idx].userId })),
      });
    });
    scored.push({ judgeId: dec.judgeId, projectId: dec.projectId, score: weighted });
  }

  // ── pairwise comparisons among submitted projects ──
  const submitted = projects.filter((p) => p.status === "SUBMITTED" || p.status === "LOCKED");
  const pairRand = mulberry32(777);
  for (let i = 0; i < submitted.length - 1; i += 1) {
    const a = submitted[i];
    const b = submitted[i + 1];
    const roll = pairRand();
    await prisma.pairwiseComparison.create({
      data: {
        eventId: event.id,
        judgeId: judgeUsers[i % judgeUsers.length].u.id,
        projectA: a.id,
        projectB: b.id,
        winner: roll < 0.45 ? "A" : roll < 0.9 ? "B" : "TIE",
      },
    });
  }

  // ── votes (incl. one suspicious velocity burst) ──
  const votable = projects.filter((p) => p.status !== "DRAFT");
  const voters = participantUsers.slice(0, 20);
  for (const v of voters) {
    const nVotes = int(1, 3);
    const chosen = new Set<string>();
    while (chosen.size < nVotes) chosen.add(pick(votable).id);
    let offset = 0;
    for (const pid of chosen) {
      await prisma.vote.create({
        data: {
          eventId: event.id, projectId: pid, userId: v.id,
          ipHash: `seed-ip-${v.id.slice(-4)}`,
          userAgent: "seed-agent/1.0",
          createdAt: new Date(d("2026-10-06T14:00:00Z").getTime() + offset * 90_000),
        },
      });
      offset++;
    }
  }
  // suspicious: 12 votes in ~41 seconds from one account
  const burstStart = d("2026-10-06T15:12:00Z").getTime();
  const burstTargets: string[] = [];
  while (burstTargets.length < 12) {
    const pid = pick(votable).id;
    if (!burstTargets.includes(pid)) burstTargets.push(pid);
  }
  for (const [i, pid] of burstTargets.entries()) {
    await prisma.vote.create({
      data: {
        eventId: event.id, projectId: pid, userId: suspiciousVoter.id,
        ipHash: "seed-ip-burst", userAgent: "burst-agent/9.9",
        createdAt: new Date(burstStart + Math.round((41_000 / 12) * i)),
        flagLevel: i >= 5 ? "SUSPICIOUS" : "NORMAL",
        flagReason: i >= 5 ? "velocity: >5 votes/60s by user" : null,
      },
    });
  }

  // ── comments ──
  const commenters = participantUsers.slice(0, 6);
  for (const [i, p] of votable.slice(0, 6).entries()) {
    await prisma.comment.create({
      data: {
        eventId: event.id, projectId: p.id,
        authorId: commenters[i % commenters.length].id,
        body: pick([
          "Killer demo — how does it handle scale?",
          "The onboarding flow is so smooth.",
          "Would love to see this open-sourced!",
          "Is the hardware BOM available anywhere?",
          "Interesting take; the UI lost me a bit though.",
        ]),
      },
    });
  }

  // ── webhook endpoint (demo) ──
  await prisma.webhookEndpoint.create({
    data: {
      eventId: event.id,
      url: "http://localhost:3999/hooks/demo",
      secret: "whsec_demo_local_secret",
      events: ["submission.submitted", "results.published", "certificate.generated"],
    },
  });

  // ── certificates for a few users ──
  const { certificateId, verificationHash } = await import("../src/server/certificates/pdf");
  for (const u of [participant, participantUsers[1], participantUsers[2]]) {
    const cid = certificateId(`${event.id}:${u.id}:PARTICIPANT`);
    await prisma.certificate.create({
      data: {
        certificateId: cid,
        eventId: event.id,
        userId: u.id,
        achievement: "PARTICIPANT",
        verificationHash: verificationHash({
          certificateId: cid, userId: u.id, eventId: event.id,
          achievement: "PARTICIPANT", issuedAt: new Date(),
        }),
      },
    });
  }

  // ── audit trail for the story ──
  await prisma.auditLog.createMany({
    data: [
      { actorId: admin.id, action: "EVENT_CREATED", resource: "event", resourceId: event.id, metadata: { slug: "dogfood-2026" } },
      { actorId: organizer.id, action: "RUBRIC_CHANGED", resource: "rubric", resourceId: rubric.id, metadata: { version: 1 } },
      { actorId: organizer.id, action: "ASSIGNMENTS_GENERATED", resource: "event", resourceId: event.id, metadata: { decisions: assignment.decisions.length, seed: 20261005 } },
      { actorId: participant.id, action: "TEAM_CREATED", resource: "team", resourceId: teams[0].id, metadata: { name: "Vector Vandals" } },
      { actorId: organizer.id, action: "CSV_EXPORTED", resource: "event", resourceId: event.id, metadata: { what: "projects" } },
    ],
  });

  console.log(
    `seeded: ${projects.length} projects, ${judgeProfiles.length} judges, ${assignment.decisions.length} assignments, ${scored.length} judgements, votes incl. suspicious burst`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
