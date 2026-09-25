"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Spinner, ErrorState, useToast } from "@/components/states";
import { SiteHeader } from "@/components/site-header";
import { OverviewTab } from "@/components/organizer/overview-tab";
import { JudgesTab } from "@/components/organizer/judges-tab";
import { RubricTab } from "@/components/organizer/rubric-tab";
import { LabTab } from "@/components/organizer/lab-tab";
import { VotingTab } from "@/components/organizer/voting-tab";
import { ResultsTab } from "@/components/organizer/results-tab";
import { OpsTab } from "@/components/organizer/ops-tab";

const TABS = [
  ["overview", "Overview"],
  ["judges", "Judges & Assignments"],
  ["rubric", "Rubric"],
  ["lab", "Normalization Lab"],
  ["voting", "Voting & Integrity"],
  ["results", "Results"],
  ["ops", "Data & Webhooks"],
] as const;

export default function OrganizerPage() {
  const [events, setEvents] = useState<{ id: string; name: string; slug: string; status: string; judgingMode: string; organizerView: boolean }[]>([]);
  const [eventId, setEventId] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("overview");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const { show, node } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ role: string; organizingEventIds: string[]; user: { role: string } }>("/api/auth/me");
        if (me.user.role !== "ORGANIZER" && me.user.role !== "ADMIN") {
          setErrMsg("This console requires the ORGANIZER or ADMIN role.");
          setState("error");
          return;
        }
        const all = await api<{ events: { id: string; name: string; slug: string; status: string }[] }>("/api/events");
        const mine = all.events.filter((e) => me.organizingEventIds.includes(e.id) || me.user.role === "ADMIN");
        setEvents(mine.map((e) => ({ ...e, judgingMode: "RUBRIC", organizerView: true })));
        if (mine[0]) setEventId(mine[0].id);
        setState("ready");
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : "Failed to load");
        setState("error");
      }
    })();
  }, []);

  if (state === "loading") return <><SiteHeader /><main className="mx-auto max-w-7xl px-4 py-8"><Spinner label="Loading organizer console…" /></main></>;
  if (state === "error") return <><SiteHeader /><main className="mx-auto max-w-7xl px-4 py-8"><ErrorState message={errMsg} /></main></>;

  const ev = events.find((e) => e.id === eventId);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Organizer console</h1>
            <p className="text-sm text-forge-400">Run the whole hackathon from here — every action hits a real, permission-checked API.</p>
          </div>
          <div className="flex gap-2">
            {events.map((e) => (
              <button
                key={e.id}
                className={e.id === eventId ? "btn-primary px-3 py-1.5 text-xs" : "btn-secondary px-3 py-1.5 text-xs"}
                onClick={() => setEventId(e.id)}
              >
                {e.name}
              </button>
            ))}
          </div>
        </div>

        {ev && (
          <>
            <nav className="mb-6 flex flex-wrap gap-1 border-b border-forge-800" aria-label="Console sections">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  className={`rounded-t-md px-4 py-2 text-sm ${tab === key ? "border-b-2 border-ember-500 text-ember-300" : "text-forge-400 hover:text-forge-200"}`}
                  aria-current={tab === key ? "page" : undefined}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </nav>

            {tab === "overview" && <OverviewTab eventId={eventId} />}
            {tab === "judges" && <JudgesTab eventId={eventId} onChanged={() => show("Saved")} />}
            {tab === "rubric" && <RubricTab eventId={eventId} onChanged={() => show("Rubric saved")} />}
            {tab === "lab" && <LabTab eventId={eventId} />}
            {tab === "voting" && <VotingTab eventId={eventId} onChanged={() => show("Voting settings saved")} />}
            {tab === "results" && <ResultsTab eventId={eventId} onChanged={() => show("Done")} />}
            {tab === "ops" && <OpsTab eventId={eventId} onChanged={() => show("Done")} />}
          </>
        )}
        {!ev && state === "ready" && (
          <div className="card px-6 py-12 text-center text-forge-400">
            You are not organizing any events yet. Ask an admin to grant you an event, or create one via <code className="text-forge-300">POST /api/events</code>.
          </div>
        )}
      </main>
      {node}
    </>
  );
}
