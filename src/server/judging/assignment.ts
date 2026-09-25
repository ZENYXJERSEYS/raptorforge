import { seededShuffle } from "@/server/util";

export interface AssignmentProjectInput {
  id: string;
  teamId: string;
  trackId: string | null;
  memberUserIds: string[];
}

export interface AssignmentJudgeInput {
  id: string;
  userId: string;
  expertise: string[];
  active: boolean;
}

export interface AssignmentInput {
  projects: AssignmentProjectInput[];
  judges: AssignmentJudgeInput[];
  judgesPerProject: number;
  trackExpertise: Record<string, string[]>; // trackId -> expertise keywords that fit
  seed: number;
}

export interface AssignmentDecision {
  projectId: string;
  judgeId: string;
  reason: string;
}

export interface AssignmentResult {
  decisions: AssignmentDecision[];
  unassigned: { projectId: string; reason: string }[];
  load: Record<string, number>; // judgeId -> assigned count
}

/**
 * Deterministic judge assignment.
 *
 * Strategy (documented in JUDGING.md):
 *  1. Projects are processed in a seeded shuffled order so no team is
 *     systematically first-come-first-served across regeneration.
 *  2. For each project, eligible judges (not on the project's team) are ranked
 *     by: track-expertise affinity desc, current load asc, seeded tiebreak.
 *  3. Each project takes the top `judgesPerProject` eligible judges.
 *  4. Conflicts of interest (judge on the project's team) are structurally
 *     impossible — filtered before ranking, and re-checked at the end.
 *
 * The same inputs + seed always produce the same output (pure function).
 */
export function computeAssignments(input: AssignmentInput): AssignmentResult {
  const { projects, judges, judgesPerProject, trackExpertise, seed } = input;
  const activeJudges = judges.filter((j) => j.active);
  const load: Record<string, number> = {};
  for (const j of activeJudges) load[j.id] = 0;

  const orderedProjects = seededShuffle(projects, seed);
  const decisions: AssignmentDecision[] = [];
  const unassigned: { projectId: string; reason: string }[] = [];

  orderedProjects.forEach((project, pIdx) => {
    const eligible = activeJudges.filter((j) => !project.memberUserIds.includes(j.userId));
    if (eligible.length === 0) {
      unassigned.push({ projectId: project.id, reason: "No eligible judge (conflict with every judge's team)." });
      return;
    }
    const want = Math.min(judgesPerProject, eligible.length);
    const keywords = project.trackId ? (trackExpertise[project.trackId] ?? []) : [];

    const ranked = [...eligible].sort((a, b) => {
      const affA = a.expertise.filter((e) => keywords.some((k) => e.toLowerCase().includes(k.toLowerCase()))).length;
      const affB = b.expertise.filter((e) => keywords.some((k) => e.toLowerCase().includes(k.toLowerCase()))).length;
      if (affB !== affA) return affB - affA;
      if (load[a.id] !== load[b.id]) return load[a.id] - load[b.id];
      // deterministic tiebreak: seeded project index + judge id
      return (a.id + String(pIdx)).localeCompare(b.id + String(pIdx));
    });

    const chosen = ranked.slice(0, want);
    for (const judge of chosen) {
      load[judge.id] = (load[judge.id] ?? 0) + 1;
      const aff = judge.expertise.filter((e) => keywords.some((k) => e.toLowerCase().includes(k.toLowerCase()))).length;
      decisions.push({
        projectId: project.id,
        judgeId: judge.id,
        reason:
          `no conflict (judge not on team) · workload ${load[judge.id]} · ` +
          (aff > 0 ? `track expertise match (${aff})` : "expertise neutral"),
      });
    }
    if (chosen.length < judgesPerProject) {
      unassigned.push({
        projectId: project.id,
        reason: `Only ${chosen.length} of ${judgesPerProject} requested judges available without conflicts.`,
      });
    }
  });

  // Final safety re-check: no judge may be assigned to a project of their own team.
  const teamOf: Record<string, Set<string>> = {};
  for (const p of projects) teamOf[p.id] = new Set(p.memberUserIds);
  const filtered = decisions.filter((d) => {
    const judge = judges.find((j) => j.id === d.judgeId);
    return judge ? !teamOf[d.projectId]?.has(judge.userId) : false;
  });

  return { decisions: filtered, unassigned, load };
}
