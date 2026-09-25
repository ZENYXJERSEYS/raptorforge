import { prisma } from "@/server/db";
import { notFound } from "next/navigation";
import { EmbedGallery } from "@/components/embed-gallery";

export const dynamic = "force-dynamic";

export default async function EmbedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await prisma.event.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!event) notFound();
  return <EmbedGallery eventId={event.id} eventName={event.name} />;
}
