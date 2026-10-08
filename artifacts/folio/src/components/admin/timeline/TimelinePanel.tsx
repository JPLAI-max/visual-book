import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetChapterTimelineQueryKey, useAutoAssembleChapter, useGetChapterTimeline, useListEditorChapters,
  usePublishChapterTimeline, useRenderChapterTimeline, useSaveChapterTimeline,
} from '@workspace/api-client-react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Block, ErrorState, Message } from '@/components/States';
import { ShotPreview } from './ShotPreview';
import { DirectorPanel } from '../director/DirectorPanel';
import {
  PRESETS, errMsg, fitToNarration, normalize, r2, sceneIssues, MIN_SHOT, isVisual, moveBoundary,
  type EditorChapter, type Preset, type Shot, type TAsset, type TimelineDoc, type TimelineScene, type Transition, type PanDir,
} from './types';

const field = 'h-9 w-full rounded border bg-background px-2 text-sm';
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Doc = { data: unknown };
type Scope = { kind: 'shot' | 'scene' | 'chapter' };

function Editor({ chapterId }: { chapterId: number }) {
  const qc = useQueryClient();
  const key = getGetChapterTimelineQueryKey(chapterId);
  const q = useGetChapterTimeline(chapterId, { query: { enabled: chapterId > 0, refetchInterval: 5000, queryKey: key } });
  const doc = (q.data as Doc | undefined)?.data as TimelineDoc | undefined;
  const save = useSaveChapterTimeline(), assemble = useAutoAssembleChapter(), render = useRenderChapterTimeline(), publish = usePublishChapterTimeline();
  const [draft, setDraft] = useState<TimelineScene[] | null>(null);
  const base = useRef(-1);
  const [sel, setSel] = useState<{ scene: number; shot: string } | null>(null);
  const [scope, setScope] = useState<Scope>({ kind: 'chapter' });
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState<'assemble' | 'publish' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [stale, setStale] = useState(false);

  const serverJson = useMemo(() => (doc ? JSON.stringify(doc.scenes) : ''), [doc]);
  const dirty = !!draft && !!doc && JSON.stringify(draft) !== serverJson;
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const rev = doc?.revision;
  useEffect(() => {
    if (!doc || rev === undefined || base.current === rev) return;
    if (dirtyRef.current) { setStale(true); return; }
    base.current = rev; setDraft(clone(doc.scenes)); setStale(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  const adopt = (res: Doc) => {
    const d = res.data as TimelineDoc;
    qc.setQueryData(key, res); base.current = d.revision; setDraft(clone(d.scenes)); setStale(false);
  };
  const fail = (e: unknown) => setMsg({ ok: false, text: errMsg(e) });

  if (q.isLoading || !draft) return q.isError ? <ErrorState onRetry={() => q.refetch()} what="this timeline" /> : <Block lines={6} />;
  if (!doc) return <ErrorState onRetry={() => q.refetch()} what="this timeline" />;

  const assets = doc.assets;
  const amap = new Map<number, TAsset>(assets.map((a) => [a.id, a]));
  const issues = draft.flatMap((s) => sceneIssues(s).map((m) => `${s.title}: ${m}`));
  const scene = sel ? draft.find((s) => s.id === sel.scene) : undefined;
  const shot = scene?.shots.find((s) => s.id === sel?.shot);
  const upd = (sid: number, fn: (s: TimelineScene) => TimelineScene) => setDraft(draft.map((s) => (s.id === sid ? normalize(fn(s)) : s)));
  const patch = (p: Partial<Shot>) => { if (scene && shot) upd(scene.id, (s) => ({ ...s, shots: s.shots.map((x) => (x.id === shot.id ? { ...x, ...p } : x)) })); };
  const approved = (id?: number) => !!(id && amap.get(id)?.foregroundApproved);

  const addShot = (s: TimelineScene) => {
    const last = s.shots[s.shots.length - 1];
    if (!last || last.duration < MIN_SHOT * 2) return setMsg({ ok: false, text: 'No shot is long enough to split (needs 1.0s).' });
    const half = r2(last.duration / 2);
    const nu: Shot = { ...clone(last), id: `shot-${Date.now().toString(36)}`, duration: r2(last.duration - half), transitionIn: 'CUT' };
    upd(s.id, (x) => ({ ...x, shots: [...x.shots.slice(0, -1), { ...last, duration: half }, nu] }));
    setSel({ scene: s.id, shot: nu.id });
  };
  const removeShot = (s: TimelineScene, id: string) => {
    if (s.shots.length < 2) return setMsg({ ok: false, text: 'A scene keeps at least one shot.' });
    const i = s.shots.findIndex((x) => x.id === id), gone = s.shots[i];
    const j = i > 0 ? i - 1 : 1;
    upd(s.id, (x) => ({ ...x, shots: x.shots.filter((y) => y.id !== id).map((y) => (y.id === s.shots[j].id ? { ...y, duration: r2(y.duration + gone.duration) } : y)) }));
    setSel(null);
  };
  const move = (s: TimelineScene, i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= s.shots.length) return;
    upd(s.id, (x) => { const a = [...x.shots]; [a[i], a[j]] = [a[j], a[i]]; return { ...x, shots: a }; });
  };
  const setPreset = (p: Preset) => {
    const cfg = PRESETS[p];
    if (p === 'Parallax' && !approved(shot?.assetId)) return;
    patch({ preset: p, ...cfg });
  };
  const setCrop = (k: 'x' | 'y' | 'width' | 'height', v: number) => {
    if (!shot) return; const c = { ...shot.crop, [k]: v };
    if (k === 'x') c.x = Math.min(v, 0.8);
    if (k === 'y') c.y = Math.min(v, 0.8);
    c.width = Math.min(c.width, r2(1 - c.x)); c.height = Math.min(c.height, r2(1 - c.y));
    patch({ crop: c });
  };
  const setZoom = (k: 'zoomStart' | 'zoomEnd', v: number) => patch({ [k]: Math.min(1.15, Math.max(1, Number.isFinite(v) ? v : 1)) });
  const shotIdx = scene && shot ? scene.shots.findIndex((x) => x.id === shot.id) : -1;
  const setBoundary = (i: number, v: number) => { if (scene && Number.isFinite(v)) upd(scene.id, (x) => moveBoundary(x, i, v)); };
  const replaceAsset = (a: TAsset) => {
    const bad = (shot?.motionType === 'PARALLAX' && !a.foregroundApproved) || (shot?.motionType === 'AI_VIDEO' && a.kind !== 'video');
    patch({ assetId: a.id, ...(bad ? { ...PRESETS.Static, preset: 'Static' as Preset, foregroundAssetId: undefined } : {}) }); setPicker(false);
  };

  const renders = doc.renders;
  const mine = renders.filter((r) => r.revision === doc.revision);
  const latest = mine[mine.length - 1];
  const ready = mine.find((r) => r.status === 'ready');
  const busy = renders.some((r) => r.status === 'queued' || r.status === 'rendering');
  const blocked = dirty || issues.length > 0;

  const run = (fn: () => void) => { setMsg(null); fn(); };
  const doSave = () => run(() => save.mutate({ chapterId, data: { revision: base.current, scenes: draft as unknown as Record<string, unknown>[] } }, { onSuccess: (r) => { adopt(r); setMsg({ ok: true, text: 'Saved as a new revision.' }); }, onError: fail }));
  const doAssemble = () => { setConfirm(null); run(() => assemble.mutate({ chapterId, data: { revision: base.current } }, { onSuccess: (r) => { adopt(r); setMsg({ ok: true, text: 'Auto-assembled from existing scene media.' }); }, onError: fail })); };
  const doRender = () => run(() => render.mutate({ chapterId, data: { revision: base.current } }, { onSuccess: (r) => { qc.setQueryData(key, r); setMsg({ ok: true, text: 'Render queued for this revision.' }); }, onError: fail }));
  const doPublish = () => { setConfirm(null); if (!ready) return; run(() => publish.mutate({ chapterId, data: { revision: base.current, renderId: ready.id } }, { onSuccess: (r) => { qc.setQueryData(key, r); setMsg({ ok: true, text: 'Published.' }); }, onError: fail })); };

  const prevScenes = scope.kind === 'chapter' ? draft : scope.kind === 'scene' && scene ? [scene] : scope.kind === 'shot' && scene && shot ? [{ ...scene, shots: [shot] }] : draft;
  const total = draft.reduce((n, s) => n + s.duration, 0);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-3 border-y py-3">
        <span className="eyebrow">Revision {doc.revision}</span>
        {dirty && <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary" data-testid="status-unsaved">Unsaved edits</span>}
        <div className="flex-1" />
        <button className="btn btn-sm btn-quiet" disabled={assemble.isPending} onClick={() => (dirty ? setConfirm('assemble') : doAssemble())} data-testid="button-auto-assemble">Auto assemble</button>
        <button className="btn btn-sm" disabled={!dirty || save.isPending || issues.length > 0} onClick={doSave} data-testid="button-save-timeline">{save.isPending ? 'Saving' : 'Save'}</button>
        <button className="btn btn-sm btn-quiet" disabled={blocked || busy || render.isPending} onClick={doRender} data-testid="button-render">Render</button>
        <button className="btn btn-sm" disabled={blocked || !ready || publish.isPending} onClick={() => setConfirm('publish')} data-testid="button-publish">Publish</button>
      </div>
      {msg && <p role="status" className={`border-l-2 pl-4 text-sm ${msg.ok ? 'border-primary/60' : 'border-destructive text-destructive'}`} data-testid="text-timeline-message">{msg.text}</p>}
      {stale && <p className="border-l-2 border-primary/60 pl-4 text-sm">A newer revision exists on the server. <button className="underline" onClick={() => { base.current = doc.revision; setDraft(clone(doc.scenes)); setStale(false); }}>Load it and discard my edits</button></p>}
      {issues.length > 0 && <ul className="space-y-1 border-l-2 border-destructive pl-4 text-sm text-destructive" data-testid="list-validation">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
      {confirm === 'assemble' && <div className="border p-4 text-sm"><p>Auto assemble replaces your unsaved custom edits with a fresh arrangement of the existing scene media.</p><div className="mt-3 flex gap-2"><button className="btn btn-sm" onClick={doAssemble} data-testid="button-confirm-assemble">Replace my edits</button><button className="btn btn-sm btn-quiet" onClick={() => setConfirm(null)}>Keep editing</button></div></div>}
      {confirm === 'publish' && ready && <div className="border p-4 text-sm"><p>Publish render {ready.id} of revision {doc.revision} to readers? It becomes the chapter video.</p><div className="mt-3 flex gap-2"><button className="btn btn-sm" onClick={doPublish} data-testid="button-confirm-publish">Publish revision {doc.revision}</button><button className="btn btn-sm btn-quiet" onClick={() => setConfirm(null)}>Cancel</button></div></div>}

      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <ShotPreview scenes={prevScenes} assets={assets} label={scope.kind} />
          <div className="flex gap-2 text-xs">
            {(['shot', 'scene', 'chapter'] as const).map((k) => (
              <button key={k} className={`rounded-full px-3 py-1 capitalize ${scope.kind === k ? 'bg-foreground text-background' : 'bg-muted'}`} disabled={k !== 'chapter' && !scene} onClick={() => setScope({ kind: k })} data-testid={`button-scope-${k}`}>{k}</button>
            ))}
            <span className="ml-auto self-center text-muted-foreground">Chapter {total.toFixed(1)}s</span>
          </div>
        </div>
        <div className="space-y-4">
          {!shot || !scene ? <p className="text-sm text-muted-foreground">Select a shot on the tracks to edit its crop, motion and transitions.</p> : (
            <div className="space-y-4 text-sm" data-testid="inspector">
              <p className="eyebrow">Shot · {scene.title}</p>
              <div className="flex items-center gap-3">
                <img src={amap.get(shot.assetId)?.url} alt="" className="h-14 w-24 rounded-[3px] bg-muted object-cover" />
                <button className="btn btn-sm btn-quiet" onClick={() => setPicker(!picker)} data-testid="button-replace-asset">Replace asset</button>
              </div>
              {picker && <div className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto border p-2">{assets.filter(isVisual).map((a) => (
                <button key={a.id} onClick={() => replaceAsset(a)} className={`relative aspect-video overflow-hidden rounded-[3px] bg-muted ${a.id === shot.assetId ? 'ring-2 ring-primary' : ''}`} title={a.name} data-testid={`asset-${a.id}`}>
                  {a.kind === 'video' ? <video src={a.url} muted className="h-full w-full object-cover" /> : <img src={a.url} alt={a.name} className="h-full w-full object-cover" />}
                </button>))}</div>}
              <label className="block"><span className="eyebrow">Motion preset</span>
                <select className={field} value={shot.preset} onChange={(e) => setPreset(e.target.value as Preset)} data-testid="select-preset">
                  {(Object.keys(PRESETS) as Preset[]).map((p) => <option key={p} value={p} disabled={p === 'Parallax' && !approved(shot.assetId)}>{p}</option>)}
                </select></label>
              {!approved(shot.assetId) && <p className="text-xs text-muted-foreground">Parallax is unavailable: this asset has no approved foreground layer. Folio does not invent movement for people or objects.</p>}
              <label className="block"><span className="eyebrow">Asset mode</span>
                <select className={field} value={shot.motionType} onChange={(e) => { const m = e.target.value as Shot['motionType']; if (m === 'PARALLAX') return setPreset('Parallax'); if (m === 'STATIC') return setPreset('Static'); patch({ motionType: m, ...(m === 'PAN_ZOOM' && shot.preset === 'Static' ? { preset: 'Slow Push In' as Preset, ...PRESETS['Slow Push In'] } : {}) }); }} data-testid="select-motion">
                  <option value="STATIC">Static</option><option value="PAN_ZOOM">Pan and zoom</option>
                  <option value="PARALLAX" disabled={!approved(shot.assetId)}>Parallax</option>
                  <option value="AI_VIDEO" disabled={amap.get(shot.assetId)?.kind !== 'video'}>Approved video</option>
                </select></label>
              {amap.get(shot.assetId)?.kind !== 'video' && <p className="text-xs text-muted-foreground">Video mode needs an approved video asset. No video is generated here.</p>}
              <div className="grid grid-cols-2 gap-3">
                {(['x', 'y', 'width', 'height'] as const).map((k) => (
                  <label key={k}><span className="eyebrow">Crop {k}</span><input type="range" className="scrub" min={k === 'width' || k === 'height' ? 0.2 : 0} max={1} step={0.01} value={shot.crop[k]} onChange={(e) => setCrop(k, Number(e.target.value))} aria-label={`Crop ${k}`} /></label>
                ))}
                <label><span className="eyebrow">Zoom start</span><input type="number" className={field} min={1} max={1.15} step={0.01} value={shot.zoomStart} onChange={(e) => setZoom('zoomStart', Number(e.target.value))} /></label>
                <label><span className="eyebrow">Zoom end</span><input type="number" className={field} min={1} max={1.15} step={0.01} value={shot.zoomEnd} onChange={(e) => setZoom('zoomEnd', Number(e.target.value))} /></label>
              </div>
              <label className="block"><span className="eyebrow">Pan</span>
                <select className={field} value={shot.panDirection} onChange={(e) => patch({ panDirection: e.target.value as PanDir })}>{['none', 'left', 'right', 'up', 'down'].map((d) => <option key={d}>{d}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3">
                {(['transitionIn', 'transitionOut'] as const).map((k) => (
                  <label key={k}><span className="eyebrow">{k === 'transitionIn' ? 'In' : 'Out'}</span>
                    <select className={field} value={shot[k]} onChange={(e) => patch({ [k]: e.target.value as Transition })} data-testid={`select-${k}`}><option>CUT</option><option>FADE</option></select></label>
                ))}
                <label><span className="eyebrow">Duration (s)</span><input type="number" className={field} min={MIN_SHOT} step={0.1} value={shot.duration} onChange={(e) => patch({ duration: Number(e.target.value) })} data-testid="input-shot-duration" /></label>
                {scene && shotIdx >= 0 && ([['start', shot.start, shotIdx === 0, shotIdx - 1], ['end', r2(shot.start + shot.duration), shotIdx === scene.shots.length - 1, shotIdx]] as const).map(([lab, val, fixed, bi]) => (
                  <label key={`${lab}-${shot.id}-${val}`}><span className="eyebrow">{lab === 'start' ? 'Start (s)' : 'End (s)'}</span>
                    <input type="number" className={field} step={0.1} defaultValue={val} disabled={fixed} title={fixed ? (lab === 'start' ? 'First shot starts at 0' : 'Last shot ends with the narration') : undefined}
                      onBlur={(e) => setBoundary(bi, Number(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} data-testid={`input-shot-${lab}`} /></label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-8" data-testid="tracks">
        {draft.map((s) => {
          const sum = s.shots.reduce((n, x) => n + x.duration, 0);
          return (
            <section key={s.id}>
              <div className="mb-2 flex flex-wrap items-baseline gap-3">
                <h3 className="serif text-xl">{s.title}</h3>
                <span className="text-xs tabular-nums text-muted-foreground">narration {s.duration.toFixed(1)}s · shots {sum.toFixed(1)}s</span>
                <div className="flex-1" />
                {Math.abs(sum - s.duration) > 0.1 && <button className="btn btn-sm btn-quiet" onClick={() => upd(s.id, fitToNarration)}>Fit to narration</button>}
                <button className="btn btn-sm btn-quiet" onClick={() => addShot(s)} data-testid={`button-add-shot-${s.id}`}><Plus className="h-3.5 w-3.5" />Shot</button>
              </div>
              <div className="space-y-1 text-[0.7rem]">
                <div className="flex gap-1" style={{ minHeight: 64 }}>
                  <span className="eyebrow w-20 shrink-0 self-center !text-[0.6rem]">Visual</span>
                  {s.shots.map((x, i) => {
                    const a = amap.get(x.assetId); const on = sel?.shot === x.id;
                    return (
                      <div key={x.id} style={{ flexGrow: Math.max(x.duration, 0.5), flexBasis: 0 }} className={`group relative min-w-[56px] overflow-hidden rounded-[3px] bg-muted ${on ? 'ring-2 ring-primary' : ''}`}>
                        <button className="block h-16 w-full" onClick={() => { setSel({ scene: s.id, shot: x.id }); setPicker(false); }} data-testid={`shot-${x.id}`} aria-label={`Select shot ${i + 1}`}>
                          {a && (a.kind === 'video' ? <video src={a.url} muted className="h-full w-full object-cover" /> : <img src={a.url} alt="" className="h-full w-full object-cover" />)}
                          <span className="absolute bottom-0 left-0 bg-[hsl(24_25%_8%/.7)] px-1.5 text-[hsl(40_33%_94%)]">{x.duration.toFixed(1)}s</span>
                        </button>
                        <span className="absolute right-0.5 top-0.5 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <button className="rounded bg-background/90 p-1" onClick={() => move(s, i, -1)} aria-label="Move earlier"><ArrowUp className="h-3 w-3 -rotate-90" /></button>
                          <button className="rounded bg-background/90 p-1" onClick={() => move(s, i, 1)} aria-label="Move later"><ArrowDown className="h-3 w-3 -rotate-90" /></button>
                          <button className="rounded bg-background/90 p-1" onClick={() => removeShot(s, x.id)} aria-label="Remove shot"><Trash2 className="h-3 w-3" /></button>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-1"><span className="eyebrow w-20 shrink-0 self-center !text-[0.6rem]">Narration</span><div className="h-5 flex-1 truncate rounded-[3px] bg-primary/10 px-2 leading-5">{s.narration}</div></div>
                <div className="flex gap-1"><span className="eyebrow w-20 shrink-0 self-center !text-[0.6rem]">Captions</span><div className="h-5 flex-1 rounded-[3px] bg-muted px-2 leading-5 text-muted-foreground">{amap.get(s.captionAssetId) ? 'WebVTT cues from narration' : 'No caption asset'}</div></div>
                <div className="flex gap-1 opacity-40"><span className="eyebrow w-20 shrink-0 self-center !text-[0.6rem]">Music</span><div className="h-4 flex-1 rounded-[3px] border border-dashed px-2 leading-4">Not available yet</div></div>
                <div className="flex gap-1 opacity-40"><span className="eyebrow w-20 shrink-0 self-center !text-[0.6rem]">SFX</span><div className="h-4 flex-1 rounded-[3px] border border-dashed px-2 leading-4">Not available yet</div></div>
              </div>
            </section>
          );
        })}
      </div>

      <DirectorPanel chapterId={chapterId} revision={base.current} dirty={dirty} />

      <section>
        <h3 className="serif mb-3 text-2xl">Renders</h3>
        {renders.length === 0 ? <p className="text-sm text-muted-foreground">No renders yet. Renders queue the saved revision and can take several minutes.</p> : (
          <ul className="divide-y border-y" data-testid="list-renders">{[...renders].reverse().map((r) => (
            <li key={r.id} className="space-y-3 py-3 text-sm">
              <div className="flex items-center gap-3"><span>Render {r.id}</span><span className="text-muted-foreground">revision {r.revision}{r.revision === doc.revision ? ' (current)' : ''}</span><span className="ml-auto rounded-full bg-muted px-3 py-1 text-xs capitalize">{r.status}</span></div>
              {r.error && <p className="text-xs text-destructive">{r.error}</p>}
              {(r.status === 'ready' || r.status === 'published') && r.asset_url && <video controls preload="metadata" src={r.asset_url} className="aspect-video w-full max-w-xl rounded-[4px] bg-[hsl(24_25%_8%)]">
                {r.caption_url && <track kind="captions" src={r.caption_url} srcLang="en" label="English" default />}
              </video>}
            </li>))}</ul>
        )}
        {latest && (latest.status === 'queued' || latest.status === 'rendering') && <p className="mt-3 text-xs text-muted-foreground">Checking status every few seconds.</p>}
      </section>
    </div>
  );
}

export function TimelinePanel() {
  const { data, isLoading, isError, refetch } = useListEditorChapters();
  const [id, setId] = useState(0);
  const chapters = ((data as Doc | undefined)?.data as { chapters?: EditorChapter[] } | undefined)?.chapters ?? [];
  if (isLoading) return <Block lines={4} />;
  if (isError) return <ErrorState onRetry={() => refetch()} what="the chapter list" />;
  if (!chapters.length) return <Message title="No chapters to edit" body="Chapters with scene media will appear here." />;
  return (
    <div className="space-y-10">
      <label className="block max-w-md"><span className="eyebrow">Chapter</span>
        <select className={field} value={id} onChange={(e) => setId(Number(e.target.value))} data-testid="select-chapter">
          <option value={0}>Choose a chapter</option>
          {chapters.map((c) => <option key={c.id} value={c.id}>{c.book_title} · {c.title} ({Math.round(c.duration)}s)</option>)}
        </select></label>
      {id > 0 ? <Editor key={id} chapterId={id} /> : <p className="text-sm text-muted-foreground">Pick a chapter to arrange its shots over the existing narration.</p>}
    </div>
  );
}
