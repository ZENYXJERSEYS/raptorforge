import { prisma } from "@/server/db";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { GalleryBrowser } from "@/components/gallery-browser";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await prisma.event.findUnique({
    where: { slug },
    include: { tracks: { orderBy: { name: "asc" } } },
  });
  if (!event) notFound();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="badge badge-info mb-2">{event.status.toLowerCase().replace("_", " ")}</div>
            <h1 className="text-3xl font-semibold tracking-tight">{event.name}</h1>
            <p className="mt-2 max-w-2xl text-forge-300">{event.description}</p>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-forge-400">
              <div><dt className="inline text-forge-500">Runs </dt><dd className="inline font-mono">{event.startDate.toISOString().slice(0, 10)} → {event.endDate.toISOString().slice(0, 10)}</dd></div>
              <div><dt className="inline text-forge-500">Submissions due </dt><dd className="inline font-mono">{event.submissionDeadline.toISOString().slice(0, 16).replace("T", " ")} UTC</dd></div>
            </dl>
          </div>
          {event.votingEnabled && (
            <a className="btn-primary" href={`/vote/${event.id}`}>Community voting →</a>
          )}
        </div>

        <GalleryBrowser eventId={event.id} tracks={event.tracks.map((t) => ({ slug: t.slug, name: t.name }))} />
      </main>
    </>
  );
}
