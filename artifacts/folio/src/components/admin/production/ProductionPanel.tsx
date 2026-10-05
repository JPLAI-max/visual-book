import { useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetBookProduction, getGetBookProductionQueryKey, useRunProductionAction, useListBooks, getListBooksQueryKey,
  type ProductionInput,
} from '@workspace/api-client-react';
import { Block, ErrorState, Message } from '@/components/States';
import { useToast } from '@/hooks/use-toast';
import { errMsg, label } from '@/lib/format';
import { ReferencesList } from './ReferencesList';
import { SceneCard } from './SceneCard';
import { currentTake, isRunning, money, takeIds, takesOf, type R } from './util';

const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'];

function Detail({ bookId }: { bookId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetBookProduction(bookId, { query: {
    queryKey: getGetBookProductionQueryKey(bookId), retry: false,
    refetchInterval: (query) => (query.state.error ? false : (query.state.data?.jobs ?? []).some((j) => isRunning(j)) ? 3000 : false),
  } });
  const act = useRunProductionAction();
  const [chapterId, setChapterId] = useState<number | null>(null);
  const [cfg, setCfg] = useState<R | null>(null);
  const [confirm, setConfirm] = useState(false);
  const d = q.data;
  if (q.isLoading) return <Block lines={6} />;
  if (q.isError || !d) return <ErrorState onRetry={() => q.refetch()} what="production" />;
  const prod = d.activeProduction as R | null;
  const conf = d.configuration as R;
  const jobs = d.jobs as R[]; const scenes = d.scenes as R[]; const refs = d.references as R[]; const renders = d.renders as R[];
  const active = jobs.some(isRunning);
  const busy = active || act.isPending;
  const pid = prod ? Number(prod.id) : undefined;
  const refsOk = refs.length > 0 && refs.every((r) => r.status === 'approved');
  const threshold = Number(conf.qualityThreshold ?? 0);
  const run = (data: R, ok: string) => {
    const body = { ...(pid != null && data.operation !== 'start_chapter' ? { productionId: pid } : {}), ...data } as unknown as ProductionInput;
    act.mutate({ bookId, data: body }, {
      onSuccess: (r) => {
        toast({ title: r.message || ok });
        qc.invalidateQueries({ queryKey: getGetBookProductionQueryKey(bookId) });
        if (data.operation === 'publish') ['/api/home', '/api/library', '/api/books', '/api/admin'].forEach((p) => qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith(p) }));
      },
      onError: (e) => { toast({ title: 'Action failed', description: errMsg(e), variant: 'destructive' }); qc.invalidateQueries({ queryKey: getGetBookProductionQueryKey(bookId) }); },
    });
  };
  const failedJobs = jobs.filter((j) => j.status === 'failed');
  const curIds = scenes.map((s) => currentTake(s)?.id).filter((x) => x != null).map(Number).sort((a, b) => a - b);
  const allApproved = scenes.length > 0 && scenes.every((s) => currentTake(s)?.status === 'approved');
  const render = renders.find((r) => r.is_current) ?? null;
  const rIds = render ? takeIds(render.scene_versions) : [];
  const fresh = !!render && render.status !== 'failed' && rIds.length === curIds.length && rIds.every((x, i) => x === curIds[i]);
  const canPublish = allApproved && fresh && !busy && !!pid;
  const voiceLocked = scenes.some((s) => takesOf(s).some((t) => t.audio_url));
  const f = cfg ?? { maxSpend: Number(prod?.max_spend ?? 10), jobMaxSpend:Number(conf.jobMaxSpend ?? 2), qualityThreshold: threshold, maxRetries: Number(conf.maxRetries ?? 1), voiceId: String(conf.voiceId ?? 'alloy'), resolution: String(conf.resolution ?? '1080p') };
  const cand = (d.candidates as R[]);
  const chosen = chapterId ?? (cand[0]?.id as number | undefined);
  const chosenC = cand.find((c) => c.id === chosen);
  const playCh = prod?.chapter_id;
  return (
    <div className="space-y-14">
      <section>
        <p className="eyebrow">Production</p>
        <p className="serif mt-1 text-3xl" data-testid="text-production-title">{d.title}</p>
        <p className="mt-2 text-sm text-muted-foreground" data-testid="text-production-status">{prod ? `Production #${prod.id} · ${label(String(prod.status))} · chapter scope only` : 'No production started. Scope is a single chapter, not the full book.'}</p>
        {prod && (
          <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
            {[['Budget', money(prod.max_spend)], ['Reserved', money(prod.reserved_spend)], ['Estimated total', money(prod.estimated_total)], ['Actual', money(prod.actual_cost)]].map(([k, v]) => <div key={k} className="border-t pt-3"><p className="eyebrow">{k}</p><p className="serif mt-1 text-2xl" data-testid={`stat-prod-${k}`}>{v}</p></div>)}
          </div>
        )}
        {prod && Number(prod.unknown_cost_requests) > 0 && <p className="mt-3 text-xs text-muted-foreground" data-testid="text-unknown-costs">{String(prod.unknown_cost_requests)} provider requests have unknown cost; actual spend may be higher than shown.</p>}
        {prod && prod.status === 'paused' && <p className="mt-3 text-sm text-destructive" data-testid="text-budget-paused">Production is paused. The reservation budget may be exhausted; raise the budget in settings to continue.</p>}
        <p className="mt-3 max-w-xl text-xs text-muted-foreground" data-testid="text-estimate-notice">{String(conf.estimateNotice ?? 'Estimates are a reservation, not an actual bill.')} The budget is a hard reservation: generation pauses when it is spent.</p>
        {active && <p className="mt-3 text-sm" data-testid="text-jobs-running">Jobs are running. Competing generation is paused.</p>}
      </section>

      {!prod && (
        <section>
          <h3 className="serif mb-3 text-2xl">Start a chapter</h3>
          {cand.length === 0 ? <p className="text-sm text-muted-foreground">No blueprint chapters. Run analysis first.</p> : (
            <div className="grid max-w-xl gap-3">
              <select className="box" value={chosen ?? ''} onChange={(e) => setChapterId(Number(e.target.value))} aria-label="Chapter" data-testid="select-chapter">{cand.map((c) => <option key={c.id} value={c.id}>{c.chapter_title} ({c.scene_count} scenes)</option>)}</select>
              <p className="text-sm" data-testid="text-preflight">Preflight estimate: {money(chosenC?.estimated_cost)} for {chosenC?.scene_count ?? 0} scenes. This is a reservation estimate, not an actual bill. Hard budget {money(f.maxSpend)}.</p>
              <div><button className="btn btn-sm" disabled={busy || !chosen} onClick={() => run({ operation: 'start_chapter', chapterId: chosen, maxSpend: Number(f.maxSpend) || 10, resolution: f.resolution }, 'Chapter started')} data-testid="button-start-chapter">Start chapter (paid generation)</button></div>
            </div>
          )}
        </section>
      )}

      {prod && (
        <>
          <section>
            <h3 className="serif mb-3 text-2xl">Reference sheets</h3>
            <p className="mb-4 text-xs text-muted-foreground">Every reference must be approved before scene jobs run.</p>
            <ReferencesList refs={refs} busy={busy} run={run} />
          </section>
          <section>
            <h3 className="serif mb-1 text-2xl">Scenes</h3>
            {scenes.length === 0 ? <p className="text-sm text-muted-foreground">No scenes yet.</p> : <ul className="divide-y border-y">{scenes.map((s) => <SceneCard key={s.id} scene={s} prod={prod} busy={busy} refsOk={refsOk} aiVideo={!!conf.aiVideoAvailable} threshold={threshold} run={run} />)}</ul>}
            {!conf.aiVideoAvailable && <p className="mt-3 text-xs text-muted-foreground" data-testid="text-ai-video-unavailable">AI video is unavailable: no video provider is connected.</p>}
          </section>
          <section>
            <h3 className="serif mb-3 text-2xl">Assembly and publish</h3>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-sm" disabled={busy || !allApproved} onClick={() => run({ operation: 'assemble' }, 'Assembly queued')} data-testid="button-assemble">Assemble preview render</button>
              <button className="btn btn-sm" disabled={!canPublish} onClick={() => setConfirm(true)} data-testid="button-publish">Publish</button>
              {playCh != null && <Link href={`/watch/${bookId}/${playCh}`} className="btn btn-sm btn-quiet" data-testid="link-play-chapter">Open in player</Link>}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{allApproved ? 'All current takes are approved.' : 'Publishing needs every current take approved.'} {render ? (fresh ? 'The current render is fresh.' : 'The current render is stale; assemble again.') : 'No render yet.'}</p>
            {renders.length > 0 && (
              <ul className="mt-4 divide-y border-y">{renders.map((r) => (
                <li key={r.id} className="py-3 text-sm" data-testid={`row-render-${r.id}`}>
                  <div className="flex flex-wrap justify-between gap-2"><span>Render #{r.id} · {label(r.status)} · {r.duration == null ? 'Unknown' : `${Number(r.duration).toFixed(1)}s`}</span><span className="rounded-full bg-muted px-3 py-1 text-xs">{r.is_current ? (fresh ? 'Current, fresh' : 'Current, stale') : 'Historical'}</span></div>
                  {r.asset_url && <video className="mt-2 w-full max-w-lg bg-muted" controls src={r.asset_url} data-testid={`video-render-${r.id}`} />}
                </li>))}</ul>
            )}
            {confirm && (
              <div className="mt-4 max-w-xl border-l-2 border-primary/60 pl-4" data-testid="panel-publish-confirm">
                <p className="text-sm">Publishing changes the active edition readers see. Sample assets and reader progress are preserved.</p>
                <div className="mt-3 flex gap-2"><button className="btn btn-sm" disabled={!canPublish} onClick={() => { run({ operation: 'publish' }, 'Published'); setConfirm(false); }} data-testid="button-confirm-publish">Confirm publish</button><button className="btn btn-sm btn-quiet" onClick={() => setConfirm(false)} data-testid="button-cancel-publish">Cancel</button></div>
              </div>
            )}
          </section>
        </>
      )}

      <section>
        <h3 className="serif mb-3 text-2xl">Jobs</h3>
        {jobs.length === 0 ? <p className="text-sm text-muted-foreground">No production jobs yet.</p> : (
          <>
            {failedJobs.length > 0 && <p className="mb-2 text-sm text-destructive">Some jobs failed. Polling continues only while jobs are running.</p>}
            <ul className="divide-y border-y">{jobs.map((j) => (
              <li key={j.id} className="py-3 text-sm" data-testid={`row-job-${j.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2"><span>{label(j.stage)}{j.target_id != null ? ` · target ${j.target_id}` : ''} · attempts {String(j.attempts)}</span>
                  <span className="flex items-center gap-2"><span className="rounded-full bg-muted px-3 py-1 text-xs">{label(j.status)}</span>
                    {['failed', 'budget_paused'].includes(j.status) && <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => run({ operation: 'retry_job', jobId: j.id }, 'Retry queued')} data-testid={`button-retry-job-${j.id}`}>Retry</button>}</span></div>
                {j.error ? <p className="mt-1 text-xs text-destructive">{String(j.error)}</p> : null}
              </li>))}</ul>
          </>
        )}
      </section>

      <section>
        <h3 className="serif mb-3 text-2xl">Settings</h3>
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2" data-testid="form-production-settings">
          <label className="text-sm"><span className="eyebrow">Hard budget (USD, 1 to 500)</span><input className="field" type="number" min={1} max={500} value={f.maxSpend} onChange={(e) => setCfg({ ...f, maxSpend: e.target.value })} data-testid="input-max-spend" /></label>
          <label className="text-sm"><span className="eyebrow">Quality threshold (0 to 100)</span><input className="field" type="number" min={0} max={100} value={f.qualityThreshold} onChange={(e) => setCfg({ ...f, qualityThreshold: e.target.value })} data-testid="input-quality-threshold" /></label>
          <label className="text-sm"><span className="eyebrow">Max retries (0 to 2)</span><input className="field" type="number" min={0} max={2} value={f.maxRetries} onChange={(e) => setCfg({ ...f, maxRetries: e.target.value })} data-testid="input-max-retries" /></label>
          <label className="text-sm"><span className="eyebrow">Per-job reservation limit (USD)</span><input className="field" type="number" min={0.05} max={100} step="0.05" value={f.jobMaxSpend ?? 2} onChange={(e) => setCfg({ ...f, jobMaxSpend: e.target.value })} data-testid="input-job-max-spend" /></label>
          <label className="text-sm"><span className="eyebrow">Resolution</span><select className="box mt-1" value={f.resolution} onChange={(e) => setCfg({ ...f, resolution: e.target.value })} data-testid="select-resolution"><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
          <label className="text-sm sm:col-span-2"><span className="eyebrow">Narrator voice (book-wide)</span><select className="box mt-1" disabled={voiceLocked} value={f.voiceId} onChange={(e) => setCfg({ ...f, voiceId: e.target.value })} data-testid="select-voice">{VOICES.map((v) => <option key={v} value={v}>{v}</option>)}</select>
            <span className="mt-1 block text-xs text-muted-foreground">{voiceLocked ? 'Locked: narration has been generated, so the voice stays consistent across the book.' : 'Locks after the first narration is generated.'}</span></label>
          <div><button className="btn btn-sm" disabled={busy} onClick={() => run({ operation: 'configure', maxSpend: Number(f.maxSpend), jobMaxSpend:Number(f.jobMaxSpend ?? 2), qualityThreshold: Number(f.qualityThreshold), maxRetries: Number(f.maxRetries), resolution: f.resolution, ...(voiceLocked ? {} : { voiceId: f.voiceId }) }, 'Settings saved')} data-testid="button-save-settings">Save settings</button></div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground" data-testid="text-providers">Image: {String(conf.imageProvider ?? '-')} {String(conf.imageModel ?? '')} · Voice: {String(conf.voiceProvider ?? '-')} {String(conf.voiceModel ?? '')} · Motion: {String(conf.motionProvider ?? '-')}. Provider keys are not managed here.</p>
      </section>
    </div>
  );
}

export function ProductionPanel() {
  const search = useSearch();
  const [, nav] = useLocation();
  const bookId = Number(new URLSearchParams(search).get('bookId')) || 0;
  const books = useListBooks(undefined, { query: { queryKey: getListBooksQueryKey() } });
  return (
    <div className="space-y-10">
      <label className="block max-w-sm text-sm"><span className="eyebrow">Book</span>
        <select className="box mt-1" value={bookId || ''} onChange={(e) => nav(e.target.value ? `/admin/production?bookId=${e.target.value}` : '/admin/production')} aria-label="Choose book" data-testid="select-production-book">
          <option value="">Choose a book</option>{books.data?.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
      </label>
      {books.isError && <ErrorState onRetry={() => books.refetch()} what="books" />}
      {bookId ? <Detail key={bookId} bookId={bookId} /> : <Message title="Choose a book" body="Pick a book to review its chapter production." />}
    </div>
  );
}
