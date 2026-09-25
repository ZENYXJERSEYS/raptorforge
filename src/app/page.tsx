import Link from "next/link";
import { prisma } from "@/server/db";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const events = await prisma.event.findMany({
    where: { status: { notIn: ["ARCHIVED", "DRAFT"] } },
    orderBy: { startDate: "desc" },
    include: { _count: { select: { projects: true, teams: true } } },
  });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-12">
        <section className="mb-14">
          <div className="badge badge-info mb-4">open source · self-hostable · offline-first</div>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            The open-source operating system for <span className="text-ember-400">hackathons</span>.
          </h1>
          <p className="mt-4 max-w-2xl text-forge-300">
            Registration → teams → submissions → deterministic judge assignment → weighted rubrics →
            cross-judge normalization → community voting → results, certificates and exports.
            Runs entirely on your infrastructure with one command.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/register" className="btn-primary">Create an account</Link>
            <Link href="/docs/api" className="btn-secondary">Explore the API</Link>
          </div>
        </section>

        <section aria-labelledby="events-h">
          <h2 id="events-h" className="mb-4 text-sm font-semibold uppercase tracking-wider text-forge-400">
            Events
          </h2>
          {events.length === 0 ? (
            <div className="card px-6 py-12 text-center text-forge-400">
              No public events yet. Organizers can create one from the console.
            </div>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {events.map((e) => (
                <li key={e.id} className="card flex flex-col gap-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/events/${e.slug}`} className="text-lg font-medium hover:text-ember-300">
                      {e.name}
                    </Link>
                    <span className="badge badge-info">{e.status.toLowerCase().replace("_", " ")}</span>
                  </div>
                  <p className="line-clamp-2 text-sm text-forge-400">{e.description}</p>
                  <dl className="mt-auto grid grid-cols-2 gap-2 text-xs text-forge-400">
                    <div>
                      <dt className="text-forge-500">Starts</dt>
                      <dd>{e.startDate.toISOString().slice(0, 10)}</dd>
                    </div>
                    <div>
                      <dt className="text-forge-500">Submissions due</dt>
                      <dd>{e.submissionDeadline.toISOString().slice(0, 16).replace("T", " ")} UTC</dd>
                    </div>
                    <div>
                      <dt className="text-forge-500">Projects</dt>
                      <dd>{e._count.projects}</dd>
                    </div>
                    <div>
                      <dt className="text-forge-500">Teams</dt>
                      <dd>{e._count.teams}</dd>
                    </div>
                  </dl>
                  <div className="flex gap-2">
                    <Link href={`/events/${e.slug}`} className="btn-secondary flex-1 px-3 py-1.5 text-center text-xs">
                      Gallery
                    </Link>
                    <Link href={`/vote/${e.id}`} className="btn-primary flex-1 px-3 py-1.5 text-center text-xs">
                      Vote
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <footer className="border-t border-forge-800 py-6 text-center text-xs text-forge-500">
        RaptorForge · MIT licensed · runs fully offline
      </footer>
    </>
  );
}
