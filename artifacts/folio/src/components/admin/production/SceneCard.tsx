import { useState } from 'react';
import { label } from '@/lib/format';
import { PreviewDialog } from './PreviewDialog';
import { MODES, currentTake, isCur, latestTake, money, parallaxReady, sceneCost, takesOf, type R } from './util';

export function SceneCard({ scene, prod, busy, refsOk, aiVideo, threshold, run }: { scene: R; prod: R | null; busy: boolean; refsOk: boolean; aiVideo: boolean; threshold: number; run: (d: R, ok: string) => void }) {
  const take = latestTake(scene);
  const [sel, setSel] = useState<number | null>(null);
  const shown = takesOf(scene).find((t) => t.id === sel) ?? take;
  const [mode, setMode] = useState<string>('PAN_ZOOM');
  const [edit, setEdit] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [neg, setNeg] = useState('');
  const [prev, setPrev] = useState(false);
  const id = scene.id as number;
  const base = { sceneId: id, ...(shown?.id ? {versionId:shown.id} : {}) };
  const cur = currentTake(scene);
  const flagged = shown?.image_url && !shown.image_approved && (shown?.quality_score != null || shown.quality?.notes?.length);
  const off = busy || !refsOk;
  const approved = shown && (shown.status === 'approved' || shown.image_approved);
  const done = shown && ['review', 'completed', 'approved', 'complete'].includes(String(shown.status)) && shown.video_url;
  const modeOk = (m: string) => (m === 'AI_VIDEO' ? aiVideo : m === 'PARALLAX' ? parallaxReady(shown) : true);
  return (
    <li className="grid gap-4 py-6 sm:grid-cols-[160px_1fr]" data-testid={`card-scene-${id}`}>
      <div>
        {shown?.image_url ? <img src={shown.image_url} alt={`Scene ${scene.scene_number}`} className="aspect-video w-full rounded-[3px] object-cover" data-testid={`img-scene-${id}`} /> : <div className="aspect-video w-full rounded-[3px] bg-muted" />}
        <button className="btn btn-sm btn-quiet mt-2" disabled={!shown} onClick={() => setPrev(true)} data-testid={`button-preview-${id}`}>Preview</button>
      </div>
      <div className="min-w-0 text-sm">
        <p className="serif text-xl">{scene.scene_number}. {scene.data?.scene_title ?? 'Untitled scene'}</p>
        <p className="mt-1 line-clamp-3 text-muted-foreground" data-testid={`text-narration-${id}`}>{shown?.narration ?? scene.data?.narration}</p>
        <p className="mt-2 text-xs text-muted-foreground" data-testid={`text-scene-meta-${id}`}>
          Duration {shown?.duration == null ? 'Unknown' : `${Number(shown.duration).toFixed(1)}s`} · Quality {shown?.quality_score == null ? 'Unknown' : Number(shown.quality_score).toFixed(1)} · {label(shown?.status ?? 'not generated')} · Motion {label(shown?.motion_type ?? '-')} · Estimate {money(sceneCost(prod, id))} · Actual Unknown
        </p>
        {flagged && <p className="mt-1 text-xs text-destructive" data-testid={`text-flag-${id}`}>Image quality is flagged (threshold {threshold}). Review the evaluator's notes before approving motion.</p>}
        {shown && shown.quality?.notes?.length > 0 && <details className="mt-2 text-xs text-muted-foreground"><summary>Quality review notes</summary><ul className="mt-2 list-disc pl-4">{shown.quality.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></details>}
        {shown && shown.assets?.length > 0 && <details className="mt-2 text-xs text-muted-foreground"><summary>Asset provenance and actual costs</summary><ul className="mt-2 space-y-1">{shown.assets.map((a: R) => <li key={a.id}>{label(a.kind)} · {a.provider} / {a.model} · actual {a.cost == null ? 'Unknown (not reported)' : money(a.cost)} · {new Date(a.created_at).toLocaleString()}</li>)}</ul></details>}
        {!refsOk && <p className="mt-1 text-xs text-muted-foreground">Approve every reference before scene generation.</p>}
        <p className="mt-1 text-xs">{cur ? `Current take ${cur.version_number}` : 'No current take'}</p>
        {takesOf(scene).length > 1 && (
          <div className="mt-2 flex flex-wrap gap-2" data-testid={`list-takes-${id}`}>{takesOf(scene).map((t) => (
            <button key={t.id} className={`rounded-full px-3 py-1 text-xs ${shown?.id === t.id ? 'bg-foreground text-background' : 'bg-muted'}`} onClick={() => setSel(t.id)} data-testid={`button-take-${t.id}`}>Take {t.version_number}{isCur(t, scene) ? ' (current)' : ''} · {label(t.status)}</button>))}</div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className="box" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Motion type" data-testid={`select-motion-${id}`}>
            {MODES.map((m) => <option key={m} value={m} disabled={!modeOk(m)}>{label(m)}{m === 'AI_VIDEO' && !aiVideo ? ' (no provider connected)' : m === 'PARALLAX' && !parallaxReady(shown) ? ' (needs approved layers)' : ''}</option>)}
          </select>
          <button className="btn btn-sm btn-quiet" disabled={off} onClick={() => run({ operation: 'regenerate_image', ...base }, 'Image queued')} data-testid={`button-regenerate-image-${id}`}>Regenerate Image</button>
          <button className="btn btn-sm btn-quiet" disabled={off || !modeOk(mode)} onClick={() => run({ operation: 'regenerate_video', ...base, motionType: mode }, 'Video queued')} data-testid={`button-regenerate-video-${id}`}>Regenerate Video</button>
          <button className="btn btn-sm btn-quiet" disabled={off} onClick={() => run({ operation: 'regenerate_voice', ...base }, 'Voice queued')} data-testid={`button-regenerate-voice-${id}`}>Regenerate Voice</button>
          <button className="btn btn-sm btn-quiet" disabled={off || !shown} onClick={() => { setPrompt(shown?.prompt ?? ''); setNeg(shown?.negative_prompt ?? ''); setEdit(!edit); }} data-testid={`button-edit-prompt-${id}`}>Edit Prompt</button>
          {aiVideo && <button className="btn btn-sm btn-quiet" disabled={off} onClick={() => run({ operation: 'upgrade_ai_video', ...base }, 'AI video queued')} data-testid={`button-upgrade-ai-${id}`}>Upgrade to AI video</button>}
        </div>
        <p className="mt-2 max-w-xl text-xs text-muted-foreground">Motion is camera movement over the still image. Characters are not animated.</p>
        {edit && shown && (
          <div className="mt-3 grid max-w-xl gap-2" data-testid={`form-prompt-${id}`}>
            <textarea className="box" rows={4} maxLength={12000} value={prompt} onChange={(e) => setPrompt(e.target.value)} data-testid={`input-prompt-${id}`} />
            <textarea className="box" rows={2} maxLength={2000} value={neg} onChange={(e) => setNeg(e.target.value)} placeholder="Negative prompt" data-testid={`input-negative-${id}`} />
            <div><button className="btn btn-sm" disabled={busy || !prompt.trim()} onClick={() => { run({ operation: 'edit_prompt', ...base, prompt, negativePrompt: neg }, 'Prompt saved'); setEdit(false); }} data-testid={`button-save-prompt-${id}`}>Save prompt</button></div>
          </div>
        )}
        {shown && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-sm" disabled={busy || !shown.image_url || !!approved} onClick={() => run({ operation: 'approve_image', versionId: shown.id }, 'Image approved')} data-testid={`button-approve-image-${id}`}>Approve image</button>
            <button className="btn btn-sm" disabled={busy || !done || shown.status === 'approved'} onClick={() => run({ operation: 'approve', versionId: shown.id }, 'Take approved')} data-testid={`button-approve-${id}`}>Approve</button>
            <button className="btn btn-sm btn-quiet" disabled={busy || shown.status === 'rejected'} onClick={() => run({ operation: 'reject', versionId: shown.id }, 'Take rejected')} data-testid={`button-reject-${id}`}>Reject</button>
            <button className="btn btn-sm btn-quiet" disabled={busy || shown.status !== 'approved' || isCur(shown, scene)} onClick={() => run({ operation: 'set_current', versionId: shown.id }, 'Current take set')} data-testid={`button-set-current-${id}`}>Set Current</button>
          </div>
        )}
      </div>
      {prev && shown && <PreviewDialog scene={scene} take={shown} onClose={() => setPrev(false)} />}
    </li>
  );
}
