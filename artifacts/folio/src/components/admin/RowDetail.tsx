import { useState } from 'react';
import { useListBooks, getListBooksQueryKey, type AdminRow } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAdminRun } from './useAdminRun';
import { BookForm } from './BookForm';
import { VersionDialog } from './VersionDialog';
import { label } from '@/lib/format';

const show = (v: unknown) => (v == null || v === '' ? '-' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v));

export function RowDetail({ row, section, onClose }: { row: AdminRow | null; section: string; onClose: () => void }) {
  const { run, pending } = useAdminRun();
  const [edit, setEdit] = useState(false);
  const [ver, setVer] = useState(false);
  const [matchedBook, setMatchedBook] = useState('');
  const books = useListBooks(undefined, { query: { queryKey: getListBooksQueryKey(), enabled: section === 'requests' } });
  if (!row) return null;
  const versions = Array.isArray(row.data?.versions) ? (row.data.versions as Record<string, unknown>[]) : [];
  const Act = ({ a, text, ok, quiet }: { a: Parameters<typeof run>[0]; text: string; ok: string; quiet?: boolean }) => (
    <button className={`btn btn-sm ${quiet ? 'btn-quiet' : ''}`} disabled={pending} onClick={() => run(a, row.id, ok, undefined, onClose)} data-testid={`button-${a}-${row.id}`}>{text}</button>
  );
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto rounded-xl bg-background">
          <DialogHeader>
            <DialogTitle className="serif text-2xl font-normal">{row.title}</DialogTitle>
            <DialogDescription>#{row.id} · {label(row.status)}{row.subtitle ? ` · ${row.subtitle}` : ''}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {(section === 'books' || section === 'catalog' || section === 'rights') && <><button className="btn btn-sm" onClick={() => setEdit(true)} data-testid="button-edit-book">Edit book and rights</button><Act a="plan_book" text="Queue text planning" ok="Planning queued" quiet /></>}
            {section === 'requests' && <>
              {!row.data.bookId && <select className="box max-w-sm" value={matchedBook} onChange={e => setMatchedBook(e.target.value)} aria-label="Match requested title to catalog book"><option value="">Match to a catalog book</option>{books.data?.map(b => <option key={b.id} value={b.id}>{b.title} — {label(b.rightsStatus)}</option>)}</select>}
              <button className="btn btn-sm" disabled={pending || (!row.data.bookId && !matchedBook)} onClick={() => run('approve_request', row.id, 'Request approved', matchedBook ? { bookId: Number(matchedBook) } : undefined, onClose)}>Approve request</button>
            </>}
            {section === 'jobs' && <><Act a="pause_job" text="Pause" ok="Job paused" quiet /><Act a="resume_job" text="Resume" ok="Job resumed" quiet /><Act a="retry_job" text="Retry" ok="Job retried" quiet /><Act a="cancel_job" text="Cancel" ok="Job cancelled" quiet /></>}
            {section === 'editions' && <><Act a="publish_edition" text="Publish edition" ok="Edition published" /><Act a="archive_edition" text="Archive" ok="Edition archived" quiet /></>}
            {section === 'scenes' && <button className="btn btn-sm" onClick={() => setVer(true)} data-testid="button-new-version">New version</button>}
          </div>
          {section === 'requests' && <p className="text-xs text-muted-foreground">Approving only marks the request approved. It does not start generation or spend anything.</p>}
           {(section === 'books' || section === 'catalog') && <p className="text-xs text-muted-foreground">Text planning analyzes a source excerpt and uses paid AI credits. It does not generate or publish media.</p>}
          {versions.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Versions</p>
              <ul className="divide-y border-y">
                {versions.map((v, i) => {
                  const vid = Number(v.id ?? 0);
                  return (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm" data-testid={`row-version-${vid}`}>
                      <span>v{show(v.version ?? i + 1)} <span className="text-muted-foreground">{label(String(v.status ?? ''))}{v.notes ? ` · ${v.notes}` : ''}</span></span>
                      <span className="flex gap-2">
                        <button className="btn btn-sm" disabled={pending} onClick={() => run('publish_version', vid, 'Version published')} data-testid={`button-publish-version-${vid}`}>Publish</button>
                        <button className="btn btn-quiet btn-sm" disabled={pending} onClick={() => run('rollback_version', vid, 'Rolled back')} data-testid={`button-rollback-version-${vid}`}>Roll back</button>
                      </span>
                       <details className="w-full"><summary className="cursor-pointer text-xs text-primary">Preview this version{v.current ? ' (current)' : ''}</summary><div className="mt-3 space-y-3">{v.videoUrl ? <video controls src={String(v.videoUrl)} className="w-full rounded" /> : v.imageUrl ? <img src={String(v.imageUrl)} alt={`Version ${v.version}`} className="max-h-48 rounded object-contain" /> : null}{v.audioUrl ? <audio controls src={String(v.audioUrl)} className="max-w-full" /> : null}<p className="text-xs leading-relaxed">{String(v.narration ?? '')}</p></div></details>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[160px_1fr]">
            {Object.entries(row.data ?? {}).filter(([k]) => k !== 'versions').map(([k, v]) => (
              <div key={k} className="contents"><dt className="eyebrow pt-0.5">{label(k)}</dt><dd className="whitespace-pre-wrap break-words">{show(v)}</dd></div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
      <BookForm open={edit} onClose={() => setEdit(false)} bookId={row.id} initial={row.data} />
      <VersionDialog open={ver} onClose={() => setVer(false)} sceneId={row.id} initial={row.data} />
    </>
  );
}
