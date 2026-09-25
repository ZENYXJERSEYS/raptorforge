"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api-client";
import { Spinner, Notice } from "@/components/states";
import { SiteHeader } from "@/components/site-header";

interface VerifyResult {
  verified: boolean;
  certificate: { certificateId: string; participant: string; event: string; achievement: string; issuedAt: string };
}

export default function VerifyPage() {
  const { certificateId } = useParams<{ certificateId: string }>();
  const [data, setData] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setData(await api<VerifyResult>(`/api/certificates/${certificateId}`));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Verification failed");
      } finally {
        setBusy(false);
      }
    })();
  }, [certificateId]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Certificate verification</h1>
        <p className="mb-6 font-mono text-sm text-forge-400">{certificateId}</p>
        {busy && <Spinner label="Checking certificate…" />}
        {!busy && error && <Notice tone="bad">{error}</Notice>}
        {!busy && data && (
          <div className="card space-y-2 p-6">
            <div className="mb-2">
              {data.verified ? (
                <Notice tone="ok">Authentic — verification hash matches this certificate's contents.</Notice>
              ) : (
                <Notice tone="bad">Hash mismatch — this certificate may have been tampered with.</Notice>
              )}
            </div>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <dt className="text-forge-500">Participant</dt><dd className="col-span-2 font-medium">{data.certificate.participant}</dd>
              <dt className="text-forge-500">Event</dt><dd className="col-span-2">{data.certificate.event}</dd>
              <dt className="text-forge-500">Achievement</dt><dd className="col-span-2">{data.certificate.achievement}</dd>
              <dt className="text-forge-500">Issued</dt><dd className="col-span-2 font-mono">{data.certificate.issuedAt.slice(0, 10)}</dd>
            </dl>
            <a className="btn-secondary mt-3" href={`/api/certificates/${certificateId}/pdf`}>Download PDF ↓</a>
          </div>
        )}
      </main>
    </>
  );
}
