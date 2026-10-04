import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetBookIntelligence, getGetBookIntelligenceQueryKey, useIngestBookSource, useRunIntelligenceAction, useListBooks, getListBooksQueryKey,
  type IntelligenceActionInput, type SourceInput,
} from '@workspace/api-client-react';
import { Block, ErrorState, Message } from '@/components/States';
import { useToast } from '@/hooks/use-toast';
import { label } from '@/lib/format';

type R = Record<string, unknown>;
const TABS = ['Overview', 'Chapters', 'Characters', 'Environments', 'Scenes', 'Visual Style', 'Narration Style'] as const;
const isObj = (v: unknown): v is R => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (v == null || v === '' ? '-' : String(v));
const dataOf = (r: R): R => (isObj(r.data) ? r.data : {});

function Value({ v }: { v: unknown }) {
  if (v == null || v === '') return <span className="text-muted-foreground">-</span>;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) return <span>{v.map(String).join(', ')}</span>;
    return <ul className="space-y-3">{v.map((x, i) => <li key={i} className="border-l-2 pl-3"><Value v={x} /></li>)}</ul>;
  }
  if (isObj(v)) return <Fields data={v} />;
  return <span className="whitespace-pre-wrap break-words">{String(v)}</span>;
}
function Fields({ data }: { data: R }) {
  const entries = Object.entries(data);
  if (!entries.length) return <p className="text-sm text-muted-foreground">No details.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[160px_1fr]">
      {entries.map(([k, v]) => <div key={k} className="contents"><dt className="eyebrow pt-0.5">{label(k)}</dt><dd className="min-w-0"><Value v={v} /></dd></div>)}
    </dl>
  );
}

function Sources({ sources, bookId, busy }: { sources: R[]; bookId: number; busy: boolean }) {
  const ingest = useIngestBookSource();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ sourceType: 'public_domain', rightsStatus: 'public_domain', rightsNotes: '', text: '', sourceUrl: '' });
  const valid = f.rightsNotes.trim().length >= 10 && f.text.length <= 2000000;
  const submit = () => {
    const data: SourceInput = { sourceType: f.sourceType as SourceInput['sourceType'], rightsStatus: f.rightsStatus as SourceInput['rightsStatus'], rightsNotes: f.rightsNotes.trim() };
    if (f.text.trim()) data.text = f.text;
    if (f.sourceUrl.trim()) data.sourceUrl = f.sourceUrl.trim();
    ingest.mutate({ bookId, data }, {
      onSuccess: (r) => { toast({ title: r.message || 'Source ingested' }); qc.invalidateQueries({ queryKey: getGetBookIntelligenceQueryKey(bookId) }); setOpen(false); setF({ ...f, rightsNotes: '', text: '', sourceUrl: '' }); },
      onError: (e) => toast({ title: 'Could not ingest source', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }),
    });
  };
  return (
    <section>
      <div className="mb-3 flex items-center justify-between"><h3 className="serif text-2xl">Sources</h3><button className="btn btn-sm btn-quiet" onClick={() => setOpen(!open)} data-testid="button-toggle-source-form">{open ? 'Close' : 'Add source'}</button></div>
      {sources.length ? (
        <ul className="divide-y border-y">{sources.map((s) => (
          <li key={String(s.id)} className="py-3 text-sm" data-testid={`row-source-${s.id}`}>
            <div className="flex flex-wrap justify-between gap-2"><span>#{str(s.id)} · {label(str(s.source_type))} · v{str(s.source_version)}</span><span className="rounded-full bg-muted px-3 py-1 text-xs">{label(str(s.rights_status))}</span></div>
            <p className="mt-1 text-muted-foreground">Scope: full book · {Number(s.char_count ?? 0).toLocaleString()} characters · {str(s.source_text_location)}</p>
            {s.rights_notes ? <p className="mt-1 text-xs text-muted-foreground">{String(s.rights_notes)}</p> : null}
          </li>))}</ul>
      ) : <p className="text-sm text-muted-foreground">No sources yet. Analyze Book will import the default full Gutenberg source automatically.</p>}
      {open && (
        <div className="mt-6 grid max-w-2xl gap-4" data-testid="form-source">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm"><span className="eyebrow">Source type</span><select className="box mt-1" value={f.sourceType} onChange={(e) => setF({ ...f, sourceType: e.target.value })} data-testid="select-source-type">{['public_domain', 'platform_owned', 'licensed', 'admin_entered'].map((v) => <option key={v} value={v}>{label(v)}</option>)}</select></label>
            <label className="text-sm"><span className="eyebrow">Rights status</span><select className="box mt-1" value={f.rightsStatus} onChange={(e) => setF({ ...f, rightsStatus: e.target.value })} data-testid="select-rights-status">{['public_domain', 'owned', 'licensed'].map((v) => <option key={v} value={v}>{label(v)}</option>)}</select></label>
          </div>
          <label className="text-sm"><span className="eyebrow">Rights notes (min 10 characters)</span><textarea className="box mt-1" rows={2} value={f.rightsNotes} onChange={(e) => setF({ ...f, rightsNotes: e.target.value })} data-testid="input-rights-notes" /></label>
          <label className="text-sm"><span className="eyebrow">Gutenberg URL (optional, allowlisted)</span><input className="field" value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} data-testid="input-source-url" /></label>
          <label className="text-sm"><span className="eyebrow">Full plain text (optional, up to 2,000,000 characters)</span><textarea className="box mt-1" rows={6} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} data-testid="input-source-text" /></label>
          <p className="text-xs text-muted-foreground">{f.text.length.toLocaleString()} characters. Paste the full manuscript, not an excerpt. Licensed sources require the catalog rights and license to be configured already.</p>
          <div><button className="btn btn-sm" disabled={!valid || ingest.isPending || busy} onClick={submit} data-testid="button-ingest-source">{ingest.isPending ? 'Ingesting…' : 'Ingest source'}</button></div>
        </div>
      )}
    </section>
  );
}

function Jobs({ jobs }: { jobs: R[] }) {
  const done = jobs.filter((j) => ['completed', 'succeeded', 'complete'].includes(str(j.status))).length;
  const pct = jobs.length ? Math.round((done / jobs.length) * 100) : 0;
  return (
    <section>
      <h3 className="serif mb-3 text-2xl">Jobs</h3>
      {jobs.length === 0 ? <p className="text-sm text-muted-foreground">No analysis jobs yet.</p> : (
        <>
          <div className="mb-4"><div className="h-1 w-full rounded bg-muted"><div className="h-1 rounded bg-primary" style={{ width: `${pct}%` }} /></div><p className="mt-1 text-xs text-muted-foreground" data-testid="text-job-progress">{done} of {jobs.length} jobs complete ({pct}%)</p></div>
          {jobs.some((j) => j.status === 'failed') && <p className="mb-3 text-sm text-destructive">A stage failed validation or provider processing. Open the stage history for details, then use Retry failed.</p>}
          <details>
          <summary className="cursor-pointer text-sm">Stage history and provider usage ({jobs.length} jobs)</summary>
          <ul className="mt-3 divide-y border-y">{jobs.map((j) => (
            <li key={String(j.id)} className="py-3 text-sm" data-testid={`row-job-${j.id}`}>
              <div className="flex flex-wrap justify-between gap-2"><span>{label(str(j.stage))}{j.target_id != null ? ` · target ${j.target_id}` : ''}</span><span className="rounded-full bg-muted px-3 py-1 text-xs">{label(str(j.status))}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">Attempts {str(j.attempts)} · {str(j.provider)} {str(j.model)} · prompt {str(j.prompt_version)} · tokens {str(j.input_tokens)}/{str(j.output_tokens)} · cost {j.cost == null ? '-' : `$${Number(j.cost).toFixed(4)}`}</p>
              {j.error ? <p className="mt-1 text-xs text-destructive">{String(j.error)}</p> : null}
            </li>))}</ul>
          </details>
        </>
      )}
    </section>
  );
}

function Card({ title, sub, data, actions }: { title: string; sub?: string; data: R; actions?: React.ReactNode }) {
  return (
    <details className="py-4">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3"><span><span className="serif text-xl">{title}</span>{sub && <span className="ml-3 text-sm text-muted-foreground">{sub}</span>}</span></summary>
      <div className="mt-4 space-y-4"><Fields data={data} />{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</div>
    </details>
  );
}

function Detail({ bookId }: { bookId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const q = useGetBookIntelligence(bookId, { query: {
    queryKey: getGetBookIntelligenceQueryKey(bookId), enabled: !!bookId, retry: false,
    refetchInterval: (query) => query.state.error ? false : query.state.data?.jobs.some((j) => ['queued', 'running'].includes(String(j.status))) ? 3000 : false,
  } });
  const act = useRunIntelligenceAction();
  const d = q.data;
  if (q.isLoading) return <Block lines={6} />;
  if (q.isError || !d) return <ErrorState onRetry={() => q.refetch()} what="book intelligence" />;
  const jobs = d.jobs as R[];
  const active = jobs.some((j) => ['queued', 'running'].includes(str(j.status)));
  const failed = jobs.some((j) => str(j.status) === 'failed');
  const analysis = d.activeAnalysis as R | null;
  const completed = !!analysis && ['completed', 'needs_review'].includes(str(analysis.status));
  const busy = active || act.isPending;
  const run = (data: IntelligenceActionInput, ok: string) => act.mutate({ bookId, data }, {
    onSuccess: (r) => { toast({ title: r.message || ok }); qc.invalidateQueries({ queryKey: getGetBookIntelligenceQueryKey(bookId) }); },
    onError: (e) => toast({ title: 'Action failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }),
  });
  const aid = analysis ? Number(analysis.id) : undefined;
  const partial = (operation: IntelligenceActionInput['operation'], targetId: number, text: string, id: string) => (
    <button key={id} className="btn btn-sm btn-quiet" disabled={busy || !completed || aid == null} onClick={() => run({ operation, analysisId: aid, targetId }, 'Queued')} data-testid={id}>{text}</button>
  );
  const sec = (k: string) => (isObj(d.sections[k]) ? (d.sections[k] as R) : null);
  const chapters = d.chapters as R[]; const characters = d.characters as R[]; const envs = d.environments as R[]; const scenes = d.scenes as R[];
  const empty = <Message title="Nothing here yet" body="Run Analyze Book to produce this part of the blueprint." />;
  const secView = (k: string) => { const s = sec(k); return s ? <div key={k} className="mb-8"><h4 className="serif mb-3 text-xl">{label(k)}</h4><Fields data={s} /></div> : null; };

  return (
    <div className="space-y-12">
      <section>
        <p className="eyebrow">Analysis</p>
        <p className="serif mt-1 text-3xl" data-testid="text-intel-title">{d.title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{analysis ? `Analysis #${str(analysis.id)} · v${str(analysis.analysis_version)} · ${label(str(analysis.status))} · full-book scope` : 'No analysis yet.'}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="btn btn-sm" disabled={busy || (!!analysis && d.sources[0]?.id === analysis.source_id)} onClick={() => run({ operation: 'analyze_book' }, 'Analysis queued')} data-testid="button-analyze-book">Analyze Book</button>
          {failed && <button className="btn btn-sm btn-quiet" disabled={busy || aid == null} onClick={() => run({ operation: 'retry_failed', analysisId: aid }, 'Retry queued')} data-testid="button-retry-failed">Retry failed</button>}
        </div>
        <p className="mt-3 max-w-xl text-xs text-muted-foreground">Analysis is structured text analysis and uses paid AI credits. No images, video or voice are generated.{active ? ' Jobs are running; controls are paused.' : ''}{completed ? ' A completed analysis exists; use the partial actions below.' : ''}</p>
        {Array.isArray(analysis?.stale_sections) && analysis.stale_sections.length > 0 && <p className="mt-3 text-sm text-muted-foreground">Chapter revision completed. Review the unchanged edition-wide sections for consistency: {analysis.stale_sections.map(String).join(', ')}. They were not automatically regenerated.</p>}
      </section>
      <Sources sources={d.sources as R[]} bookId={bookId} busy={busy} />
      <Jobs jobs={jobs} />
      <section>
        <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2 border-b pb-3" role="tablist">
          {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`text-sm ${tab === t ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setTab(t)} data-testid={`tab-${t.toLowerCase().replace(' ', '-')}`}>{t}</button>)}
        </div>
        {tab === 'Overview' && (['overview', 'themes', 'structure', 'chapter_detection'].map(secView).some(Boolean) ? <>{['overview', 'themes', 'structure', 'chapter_detection'].map(secView)}</> : empty)}
        {tab === 'Visual Style' && (secView('visual_style') ?? empty)}
        {tab === 'Narration Style' && (secView('narration_style') ?? empty)}
        {tab === 'Chapters' && (chapters.length ? <div className="divide-y border-y">{chapters.map((c) => (
          <Card key={String(c.id)} title={str(dataOf(c).chapter_title ?? c.chapter_title ?? dataOf(c).title ?? c.chapter_name ?? c.name ?? `Chapter ${c.chapter_number}`)} sub={`Source section ${str(c.chapter_number)}`} data={dataOf(c)}
            actions={<>{partial('reanalyze_chapter', Number(c.id), 'Reanalyze', `button-reanalyze-chapter-${c.id}`)}{partial('regenerate_scenes', Number(c.id), 'Regenerate scenes', `button-regenerate-scenes-${c.id}`)}</>} />))}</div> : empty)}
        {tab === 'Characters' && (characters.length ? <div className="divide-y border-y">{characters.map((c) => (
          <Card key={String(c.id)} title={str(dataOf(c).name ?? c.name)} data={dataOf(c)} actions={partial('regenerate_character', Number(c.id), 'Regenerate', `button-regenerate-character-${c.id}`)} />))}</div> : empty)}
        {tab === 'Environments' && (envs.length ? <div className="divide-y border-y">{envs.map((c) => (
          <Card key={String(c.id)} title={str(dataOf(c).name ?? c.name)} data={dataOf(c)} actions={partial('regenerate_environment', Number(c.id), 'Regenerate', `button-regenerate-environment-${c.id}`)} />))}</div> : empty)}
        {tab === 'Scenes' && (scenes.length ? <div className="divide-y border-y">{scenes.map((c) => (
          <Card key={String(c.id)} title={str(dataOf(c).title ?? dataOf(c).name ?? `Scene ${c.id}`)} sub={c.chapter_id != null ? `Chapter ${c.chapter_id}` : undefined} data={dataOf(c)} />))}</div> : empty)}
      </section>
    </div>
  );
}

export function IntelligencePanel() {
  const search = useSearch();
  const [, nav] = useLocation();
  const bookId = Number(new URLSearchParams(search).get('bookId')) || 0;
  const books = useListBooks(undefined, { query: { queryKey: getListBooksQueryKey() } });
  return (
    <div className="space-y-10">
      <label className="block max-w-sm text-sm"><span className="eyebrow">Book</span>
        <select className="box mt-1" value={bookId || ''} onChange={(e) => nav(e.target.value ? `/admin/intelligence?bookId=${e.target.value}` : '/admin/intelligence')} aria-label="Choose book" data-testid="select-intelligence-book">
          <option value="">Choose a book</option>{books.data?.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
      </label>
      {books.isError && <ErrorState onRetry={() => books.refetch()} what="books" />}
      {bookId ? <Detail key={bookId} bookId={bookId} /> : <Message title="Choose a book" body="Pick a book to see its production blueprint." />}
    </div>
  );
}
