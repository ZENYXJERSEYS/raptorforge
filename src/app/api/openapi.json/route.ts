import { handler, ok } from "@/server/api";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "RaptorForge API",
    version: "1.0.0",
    description:
      "Open-source, self-hostable hackathon submission & judging platform. All mutating endpoints require a session cookie (rf_session) unless noted public.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "auth" }, { name: "events" }, { name: "teams" }, { name: "submissions" },
    { name: "gallery" }, { name: "judging" }, { name: "voting" }, { name: "results" },
    { name: "certificates" }, { name: "webhooks" }, { name: "system" },
  ],
  components: {
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
            required: ["code", "message"],
          },
        },
      },
      User: {
        type: "object",
        properties: { id: { type: "string" }, email: { type: "string" }, name: { type: "string" }, role: { type: "string", enum: ["PARTICIPANT", "JUDGE", "ORGANIZER", "ADMIN"] } },
      },
      Event: {
        type: "object",
        properties: {
          id: { type: "string" }, name: { type: "string" }, slug: { type: "string" },
          status: { type: "string", enum: ["DRAFT", "REGISTRATION_OPEN", "ACTIVE", "SUBMISSIONS_CLOSED", "JUDGING", "VOTING", "COMPLETED", "ARCHIVED"] },
          judgingMode: { type: "string", enum: ["RUBRIC", "PAIRWISE"] },
          submissionDeadline: { type: "string", format: "date-time" },
        },
      },
      Project: {
        type: "object",
        properties: {
          id: { type: "string" }, name: { type: "string" }, slug: { type: "string" },
          status: { type: "string", enum: ["DRAFT", "SUBMITTED", "LOCKED", "DISQUALIFIED"] },
          technologies: { type: "array", items: { type: "string" } },
        },
      },
      JudgementInput: {
        type: "object",
        required: ["projectId", "scores"],
        properties: {
          projectId: { type: "string" },
          comment: { type: "string", maxLength: 5000 },
          scores: {
            type: "array",
            items: {
              type: "object",
              required: ["criterionId", "value"],
              properties: { criterionId: { type: "string" }, value: { type: "integer" } },
            },
          },
        },
      },
    },
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "rf_session" },
    },
  },
  paths: {
    "/api/health": { get: { tags: ["system"], summary: "System health", security: [], responses: { "200": { description: "Health report" }, "503": { description: "Degraded" } } } },
    "/api/openapi.json": { get: { tags: ["system"], summary: "This document", security: [], responses: { "200": { description: "OpenAPI spec" } } } },
    "/api/auth/register": {
      post: {
        tags: ["auth"], summary: "Create an account", security: [],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "name", "password"], properties: { email: { type: "string", format: "email" }, name: { type: "string" }, password: { type: "string", minLength: 8 } } } } } },
        responses: { "201": { description: "Account created" }, "409": { description: "Email exists" }, "422": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["auth"], summary: "Log in", security: [],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string" }, password: { type: "string" } } } } } },
        responses: { "200": { description: "Session cookie set" }, "401": { description: "Invalid credentials" }, "429": { description: "Rate limited" } },
      },
    },
    "/api/auth/logout": { post: { tags: ["auth"], summary: "Log out", responses: { "200": { description: "Session destroyed" } } } },
    "/api/auth/me": { get: { tags: ["auth"], summary: "Current user with roles/memberships", responses: { "200": { description: "User context" }, "401": { description: "Not signed in" } } } },
    "/api/events": {
      get: { tags: ["events"], summary: "List public events", security: [], responses: { "200": { description: "Events" } } },
      post: { tags: ["events"], summary: "Create event (organizer/admin)", responses: { "201": { description: "Created" }, "403": { description: "Forbidden" } } },
    },
    "/api/events/{id}": {
      get: { tags: ["events"], summary: "Event detail (public)", security: [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Event" }, "404": { description: "Not found" } } },
      patch: { tags: ["events"], summary: "Update event incl. voting config (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" }, "403": { description: "Not an organizer" } } },
    },
    "/api/events/{id}/tracks": {
      get: { tags: ["events"], summary: "List tracks", security: [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Tracks" } } },
      post: { tags: ["events"], summary: "Create track (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Created" } } },
    },
    "/api/events/{id}/prizes": {
      get: { tags: ["events"], summary: "List prizes", security: [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Prizes" } } },
      post: { tags: ["events"], summary: "Create prize (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Created" } } },
    },
    "/api/events/{id}/judges": {
      get: { tags: ["judging"], summary: "Judge list with progress (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Judges" } } },
      post: { tags: ["judging"], summary: "Invite judge (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Invited" } } },
      patch: { tags: ["judging"], summary: "Activate/deactivate judge (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" } } },
    },
    "/api/events/{id}/assignments": {
      get: { tags: ["judging"], summary: "Assignments with reasons (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Assignments" } } },
      post: { tags: ["judging"], summary: "Generate deterministic assignments (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Created; includes per-project unassigned reasons and load map" } } },
    },
    "/api/events/{id}/rubric": {
      get: { tags: ["judging"], summary: "Get rubric (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Rubric" } } },
      put: { tags: ["judging"], summary: "Create/replace rubric; weights must sum to 100 (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Rubric saved" }, "422": { description: "Weights invalid" } } },
    },
    "/api/events/{id}/judge-queue": { get: { tags: ["judging"], summary: "My assigned projects + progress (judge)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Queue" }, "403": { description: "Not an active judge" } } } },
    "/api/events/{id}/judgements": {
      post: {
        tags: ["judging"], summary: "Submit/replace a judgement (judge, assigned only)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/JudgementInput" } } } },
        responses: { "201": { description: "Judgement stored with server-computed weighted score" }, "403": { description: "Not assigned" }, "423": { description: "Judging closed" } },
      },
      get: { tags: ["judging"], summary: "My judgements (judge)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Judgements" } } },
    },
    "/api/events/{id}/pairwise": {
      get: { tags: ["judging"], summary: "Pairwise standings (organizer) or eligible pairs (judge)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Standings/pairs" } } },
      post: { tags: ["judging"], summary: "Record A/B/TIE comparison (judge)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Recorded" } } },
    },
    "/api/events/{id}/normalization": { get: { tags: ["results"], summary: "Normalization lab data + methodology (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Lab data" } } } },
    "/api/events/{id}/results": {
      get: { tags: ["results"], summary: "Results (public only when published/revealed)", security: [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Results" }, "403": { description: "Hidden" }, "404": { description: "Not generated" } } },
      post: { tags: ["results"], summary: "generate | publish | unpublish (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Generated" }, "200": { description: "Publish state changed" } } },
    },
    "/api/events/{id}/voting": { get: { tags: ["voting"], summary: "Voting view with per-user randomized order (auth)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Ballot" }, "403": { description: "Voting closed" } } } },
    "/api/events/{id}/integrity": { get: { tags: ["voting"], summary: "Vote integrity dashboard (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Flags + velocity" } } } },
    "/api/teams": {
      get: { tags: ["teams"], summary: "Event teams (public)", security: [], parameters: [{ name: "eventId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "Teams" } } },
      post: { tags: ["teams"], summary: "Create team (registration window enforced)", responses: { "201": { description: "Created" }, "409": { description: "Already on a team" } } },
      put: { tags: ["teams"], summary: "Create invite link (owner)", responses: { "201": { description: "Token issued" } } },
    },
    "/api/teams/join": { post: { tags: ["teams"], summary: "Join via invite token", responses: { "201": { description: "Joined" }, "404": { description: "Invalid token" } } } },
    "/api/teams/{id}/leave": { post: { tags: ["teams"], summary: "Leave team", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Left (or team deleted if sole owner)" } } } },
    "/api/submissions": {
      get: { tags: ["submissions"], summary: "My teams' submissions", responses: { "200": { description: "Submissions" } } },
      post: { tags: ["submissions"], summary: "Create draft submission (team member)", responses: { "201": { description: "Draft created" }, "409": { description: "Team already has a project" } } },
    },
    "/api/submissions/{id}": {
      get: { tags: ["submissions"], summary: "Submission detail (team member)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Submission" } } },
      patch: { tags: ["submissions"], summary: "Edit draft (locked → 403)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Updated" }, "403": { description: "Locked/submitted" } } },
    },
    "/api/submissions/{id}/submit": { post: { tags: ["submissions"], summary: "Submit; deadline enforced server-side (423 when passed)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Submitted" }, "423": { description: "SUBMISSION_DEADLINE_PASSED" } } } },
    "/api/projects": { get: { tags: ["gallery"], summary: "Public gallery: q, track, tech, sort, page", security: [], parameters: [{ name: "eventId", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "Projects + pagination" } } } },
    "/api/projects/{id}": { get: { tags: ["gallery"], summary: "Project detail + visible comments; vote counts only when visible", security: [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Project" }, "404": { description: "Not found" } } } },
    "/api/projects/{id}/votes": { post: { tags: ["voting"], summary: "Cast a vote (quota + rate limits + flags)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Vote stored" }, "403": { description: "Voting closed/quota reached" }, "409": { description: "Duplicate vote" }, "429": { description: "Rate limited" } } } },
    "/api/projects/{id}/comments": {
      get: { tags: ["gallery"], summary: "Project comments", security: [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Comments" } } },
      post: { tags: ["gallery"], summary: "Comment (rate limited)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Created" } } },
      delete: { tags: ["gallery"], summary: "Delete own comment / moderate (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Hidden" } } },
    },
    "/api/projects/{id}/moderate": { post: { tags: ["submissions"], summary: "LOCK | UNLOCK | DISQUALIFY (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Status changed" } } } },
    "/api/audit-log": { get: { tags: ["system"], summary: "Audit trail with filters (organizer/admin)", responses: { "200": { description: "Entries" } } } },
    "/api/events/{id}/export": { get: { tags: ["system"], summary: "CSV export: what=participants|teams|projects|judges|assignments|scores|normalized-scores|votes|results|audit", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "text/csv" } } } },
    "/api/events/{id}/import": { post: { tags: ["system"], summary: "CSV bulk import (participants|projects) with row-level errors", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Imported" }, "422": { description: "Rejected with row errors" } } } },
    "/api/events/{id}/certificates": {
      get: { tags: ["certificates"], summary: "List certificates (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Certificates" } } },
      post: { tags: ["certificates"], summary: "Issue certificate (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Issued" } } },
    },
    "/api/certificates/{certificateId}": { get: { tags: ["certificates"], summary: "Public verification (privacy-preserving)", security: [], parameters: [{ name: "certificateId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Verification result" }, "404": { description: "Unknown ID" } } } },
    "/api/certificates/{certificateId}/pdf": { get: { tags: ["certificates"], summary: "Download certificate PDF (locally generated)", security: [], parameters: [{ name: "certificateId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "application/pdf" } } } },
    "/api/events/{id}/webhooks": {
      get: { tags: ["webhooks"], summary: "List endpoints + recent deliveries (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Endpoints" } } },
      post: { tags: ["webhooks"], summary: "Create endpoint (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Created" } } },
      delete: { tags: ["webhooks"], summary: "Delete endpoint (organizer)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Deleted" } } },
    },
    "/api/events/{id}/webhooks/dispatch": { post: { tags: ["webhooks"], summary: "Dispatch pending deliveries now", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Dispatch summary" } } } },
  },
};

export const GET = handler(async () => ok(spec));
