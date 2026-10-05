import { label } from '@/lib/format';
import type { R } from './util';

export function ReferencesList({ refs, busy, run }: { refs: R[]; busy: boolean; run: (d: R, ok: string) => void }) {
  if (!refs.length) return <p className="text-sm text-muted-foreground">No reference sheets yet. They are produced after the chapter is started.</p>;
  return (
    <ul className="grid gap-6 sm:grid-cols-2">
      {refs.map((r) => (
        <li key={r.id} className="border-t pt-4" data-testid={`row-reference-${r.id}`}>
          <div className="flex gap-4">
            {r.asset_url ? <img src={r.asset_url} alt={r.name} className="h-28 w-20 rounded-[3px] object-cover" /> : <div className="h-28 w-20 rounded-[3px] bg-muted" />}
            <div className="min-w-0 text-sm">
              <p className="serif text-xl">{r.name}</p>
              <p className="text-muted-foreground">{label(r.kind)} · {label(r.status)}</p>
              <p className="text-xs text-muted-foreground">Quality {r.quality_score == null ? 'Unknown' : Number(r.quality_score).toFixed(1)}</p>
            </div>
          </div>
          {r.data?.quality?.notes?.length > 0 && <details className="mt-2 text-xs text-muted-foreground"><summary>Quality review notes</summary><ul className="mt-2 list-disc pl-4">{r.data.quality.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></details>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-sm" disabled={busy || r.status === 'approved'} onClick={() => run({ operation: 'approve_reference', referenceId: r.id }, 'Reference approved')} data-testid={`button-approve-reference-${r.id}`}>Approve</button>
            <button className="btn btn-sm btn-quiet" disabled={busy || r.status === 'rejected'} onClick={() => run({ operation: 'reject_reference', referenceId: r.id }, 'Reference rejected')} data-testid={`button-reject-reference-${r.id}`}>Reject</button>
            <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => run({ operation: 'regenerate_reference', referenceId: r.id }, 'Regeneration queued')} data-testid={`button-regenerate-reference-${r.id}`}>Regenerate</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
