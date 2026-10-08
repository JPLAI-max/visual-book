import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetChapterTimelineQueryKey, getGetVisualDirectorQueryKey, useGetVisualDirector, useVisualDirectorAction } from '@workspace/api-client-react';
import { Block, ErrorState } from '@/components/States';
import { ShotPreview } from '../timeline/ShotPreview';
import { errMsg } from '../timeline/types';
import { CostBar } from './CostBar';
import { ShotCard } from './ShotCard';
import type { DirectorDoc } from './types';

const field = 'h-9 w-full rounded border bg-background px-2 text-sm';
const ACTIVE = ['queued', 'running', 'processing', 'pending'];

export function DirectorPanel({ chapterId, revision, dirty }: { chapterId: number; revision: number; dirty: boolean }) {
  const qc = useQueryClient();
  const key = getGetVisualDirectorQueryKey(chapterId);
  const q = useGetVisualDirector(chapterId, { query: { enabled: chapterId > 0, queryKey: key, refetchInterval: 5000 } });
  const mut = useVisualDirectorAction();
  const doc = (q.data as { data: unknown } | undefined)?.data as unknown as DirectorDoc | undefined;
  const [runSel, setRunSel] = useState<number | null>(null);
  const [pacing, setPacing] = useState({ shortSeconds: 12, mediumSeconds: 30, shortMax: 2, mediumMax: 4, longMax: 8 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [view, setView] = useState<'current' | 'directed'>('current');
  const [pending, setPending] = useState<{ body: Record<string, unknown>; text: string } | null>(null);

  if (q.isLoading) return <Block lines={4} />;
  if (q.isError || !doc) return <ErrorState onRetry={() => q.refetch()} what="the visual director" />;
  const runs = doc.runs ?? [];
  const run = runs.find((r) => r.id === runSel) ?? runs[0];
  const jobs = (doc.jobs ?? []).filter((j) => !run || j.run_id === run.id);
  const working = jobs.some((j) => ACTIVE.includes(j.status)) || (run ? run.status === 'planning' : false);
  const busy = mut.isPending || working;
  const review = (doc.reviews ?? []).find((r) => r.run_id === run?.id);

  const send = (body: Record<string, unknown>) => {
    setPending(null); setMsg(null);
    mut.mutate({ chapterId, data: body as never }, {
      onSuccess: (r) => {
        qc.setQueryData(key, (old: unknown) => (r?.data && (r.data as unknown as DirectorDoc).runs ? r : old));
        qc.invalidateQueries({ queryKey: key });
        if (body.action === 'assemble' || body.action === 'approve') qc.invalidateQueries({ queryKey: getGetChapterTimelineQueryKey(chapterId) });
        if (body.action === 'assemble') setView('directed');
        setMsg({ ok: true, text: `${String(body.action).replace('_', ' ')} accepted.` });
      },
      onError: (e) => setMsg({ ok: false, text: errMsg(e) }),
    });
  };
  const act = (body: Record<string, unknown>, paid?: string) => (paid ? setPending({ body, text: paid }) : send(body));
  const pn = (k: keyof typeof pacing, label: string) => (
    <label key={k}><span className="eyebrow">{label}</span><input type="number" min={1} className={field} value={pacing[k]} onChange={(e) => setPacing({ ...pacing, [k]: Number(e.target.value) })} data-testid={`input-pacing-${k}`} /></label>
  );
  const cmp = run ? {current:run.baseline??doc.comparison?.current,directed:run.definition?.scenes?.length?{scenes:run.definition.scenes}:null}:doc.comparison;
  const scenes = view === 'directed' ? cmp?.directed?.scenes : cmp?.current?.scenes;

  return (
    <section className="space-y-6" data-testid="panel-director">
      <h3 className="serif text-2xl">Visual Director</h3>
      <CostBar cost={doc.cost} video={doc.video} />
      <div className="space-y-3">
        <p className="eyebrow">Pacing</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {pn('shortSeconds', 'Short scene up to (s)')}{pn('mediumSeconds', 'Medium up to (s)')}{pn('shortMax', 'Short max shots')}{pn('mediumMax', 'Medium max shots')}{pn('longMax', 'Long max shots')}
        </div>
        <button className="btn btn-sm" disabled={busy} onClick={() => act({ action: 'direct', pacing }, 'Plan the whole chapter? Image generation after planning is separately confirmed and paid.')} data-testid="button-direct">Direct chapter</button>
      </div>
      {msg && <p role="status" className={`border-l-2 pl-4 text-sm ${msg.ok ? 'border-primary/60' : 'border-destructive text-destructive'}`} data-testid="text-director-message">{msg.text}</p>}
      {pending && <div className="border p-4 text-sm"><p>{pending.text}</p><p className="mt-1 text-xs text-muted-foreground">Costs are reservation estimates; the actual cost may differ.</p>
        <div className="mt-3 flex gap-2"><button className="btn btn-sm" onClick={() => send(pending.body)} data-testid="button-confirm-paid">Confirm</button><button className="btn btn-sm btn-quiet" onClick={() => setPending(null)}>Cancel</button></div></div>}
      {working && <p className="text-xs text-muted-foreground">Work in progress. Checking every 5 seconds.</p>}
      {jobs.some((j) => j.status === 'failed') && (
        <ul className="space-y-1 border-l-2 border-destructive pl-4 text-sm" data-testid="list-failed-jobs">{jobs.filter((j) => j.status === 'failed').map((j) => (
          <li key={j.id} className="flex flex-wrap items-center gap-3"><span className="text-destructive">{j.kind} failed{j.error ? `: ${j.error}` : ''}</span>
            <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => act({ action: 'retry', runId: j.run_id, jobId: j.id }, 'Retry this failed job? Cost-tracked work may be charged again.')} data-testid={`button-retry-${j.id}`}>Retry</button></li>))}</ul>)}
      {!run ? <p className="text-sm text-muted-foreground" data-testid="text-director-empty">No director run yet. Direct the chapter to propose shots over the existing narration. The published movie is not affected.</p> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <select className={`${field} max-w-xs`} value={run.id} onChange={(e) => setRunSel(Number(e.target.value))} data-testid="select-run">
              {runs.map((r) => <option key={r.id} value={r.id}>Run {r.id} · {r.status} · {new Date(r.created_at).toLocaleString()}</option>)}</select>
            {run.directed_revision != null && <span className="text-xs text-muted-foreground">Assembled as revision {run.directed_revision}</span>}
            <div className="flex-1" />
            <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => act({ action: 'generate', runId: run.id }, 'Generate all missing images for this run? This is a paid call.')} data-testid="button-generate-missing">Generate missing images</button>
            <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => act({ action: 'review', runId: run.id })} data-testid="button-review">Review chapter</button>
            <button className="btn btn-sm" disabled={busy || dirty} title={dirty ? 'Save or discard your timeline edits first' : undefined} onClick={() => act({ action: 'assemble', runId: run.id, revision })} data-testid="button-assemble-directed">Assemble first cut</button>
          </div>
          {review && <div className="border-l-2 border-primary/60 pl-4 text-sm" data-testid="text-review"><p className="capitalize">Review {review.status}</p>{review.result?.recommendations ? <pre className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(review.result.recommendations, null, 1)}</pre> : null}</div>}
          <div className="space-y-3">
            <div className="flex gap-2 text-xs">{(['current', 'directed'] as const).map((k) => <button key={k} className={`rounded-full px-3 py-1 capitalize ${view === k ? 'bg-foreground text-background' : 'bg-muted'}`} onClick={() => setView(k)} data-testid={`button-compare-${k}`}>{k}</button>)}
              <button className="rounded-full bg-muted px-3 py-1" disabled={busy} onClick={() => act({ action: 'compare', runId: run.id })} data-testid="button-compare">Refresh comparison</button></div>
             {scenes && scenes.length ? <ShotPreview key={`${run?.id}-${view}`} scenes={scenes} assets={doc.assets ?? []} label={view} /> : <p className="text-sm text-muted-foreground">{view === 'directed' ? 'No assembled directed cut yet. Assemble the first cut to preview it.' : 'No current timeline to preview.'}</p>}
          </div>
          {run.scenes.length === 0 && <p className="text-sm text-muted-foreground">This run has no scenes yet.</p>}
          {run.scenes.map((s) => (
            <div key={s.id} data-testid={`director-scene-${s.scene_id}`}>
              <div className="flex flex-wrap items-baseline gap-3"><h4 className="serif text-xl">{s.scene_number}. {s.title}</h4>
                <span className="text-xs text-muted-foreground">{s.shots.length} shots</span><div className="flex-1" />
                <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => act({ action: 're_direct_scene', runId: run.id, sceneId: s.scene_id }, 'Re-direct this scene as a new run? Replanned shots may need paid image generation.')} data-testid={`button-redirect-${s.scene_id}`}>Re-direct scene</button></div>
               {s.continuity && <p className="text-xs text-muted-foreground">Continuity: {typeof s.continuity==='string'?s.continuity:s.continuity.continuity_notes??JSON.stringify(s.continuity)}</p>}
              <ul className="divide-y border-y">{s.shots.map((sh) => <ShotCard key={sh.id} shot={sh} runId={run.id} video={doc.video} act={act} busy={busy} />)}</ul>
            </div>))}
        </div>
      )}
    </section>
  );
}
