import { useState } from 'react';
import type { DShot, DirectorDoc, Version } from './types';
import { ANGLES, DISTANCES, MOTIONS, MOVES, SHOT_TYPES, money, qcPass } from './types';

const field = 'h-9 w-full rounded border bg-background px-2 text-sm';
type Act = (a: Record<string, unknown>, paid?: string) => void;

function Thumb({ v, on, onClick }: { v: Version; on: boolean; onClick: () => void }) {
  const src = v.image_url;
  return (
    <button onClick={onClick} className={`w-24 shrink-0 text-left text-[0.65rem] ${on ? 'ring-2 ring-primary' : ''}`} data-testid={`version-${v.id}`}>
      <span className="block aspect-video overflow-hidden rounded-[3px] bg-muted">{src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-muted-foreground">No image</span>}</span>
      <span className="block capitalize">{v.status} · est {money(v.estimatedCost)} · actual {money(v.actualCost)}{v.quality?.score != null ? ` · QC ${v.quality.score}` : ' · no QC'}</span>
    </button>
  );
}

export function ShotCard({ shot, runId, video, act, busy }: { shot: DShot; runId: number; video?: DirectorDoc['video']; act: Act; busy: boolean }) {
  const b0 = shot.blueprint;
  const [vid, setVid] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [ch, setCh] = useState<Record<string, string>>({});
  const cur = shot.versions.find((v) => v.id === (vid ?? shot.current_version_id)) ?? shot.versions[shot.versions.length - 1];
  const b = { ...b0, ...((cur?.spec ?? {}) as Partial<typeof b0>) };
  const base = { runId, shotId: shot.id, versionId: cur?.id };
  const set = (k: string, v: string) => setCh((c) => (v ? { ...c, [k]: v } : Object.fromEntries(Object.entries(c).filter(([x]) => x !== k))));
  const sel = (k: string, val: string | undefined, opts: string[], label: string) => (
    <label><span className="eyebrow">{label}</span>
      <select className={field} value={ch[k] ?? ''} onChange={(e) => set(k, e.target.value)} data-testid={`select-${k}-${shot.id}`}>
        <option value="">Keep ({val ?? 'unset'})</option>{opts.map((o) => <option key={o}>{o}</option>)}
      </select></label>
  );
  const content = ['shot_type', 'composition', 'camera_angle', 'camera_distance'].some((k) => ch[k]);
  const approved = cur?.status === 'approved';
  const qc = cur?.quality;
  return (
    <li className="space-y-3 py-4 text-sm" data-testid={`card-shot-${shot.id}`}>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="serif text-lg">Shot {b.shot_number}</span>
        <span className="rounded-full bg-muted px-3 py-0.5 text-xs">{b.shot_type}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{b.start_time.toFixed(1)}s, {b.duration.toFixed(1)}s</span>
        {b.motion_recommendation && <span className="text-xs text-muted-foreground">motion: {b.motion_recommendation}</span>}
        <span className={`ml-auto rounded-full px-3 py-0.5 text-xs capitalize ${approved ? 'bg-primary/10 text-primary' : 'bg-muted'}`}>{cur ? cur.status : 'no version'}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <div className="aspect-video overflow-hidden rounded-[4px] bg-muted">
            {cur?.video_url ? <video src={cur.video_url} controls muted className="h-full w-full object-cover" /> : cur?.image_url ? <img src={cur.image_url} alt={b.visual_subject ?? ''} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted-foreground">Image not generated yet</div>}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1" data-testid={`history-${shot.id}`}>
            {shot.versions.length === 0 ? <span className="text-xs text-muted-foreground">No versions</span> : shot.versions.map((v) => <Thumb key={v.id} v={v} on={v.id === cur?.id} onClick={() => setVid(v.id)} />)}
          </div>
        </div>
        <div className="space-y-2">
          {b.narration_beat && <p><span className="eyebrow">Narration beat </span>{b.narration_beat}</p>}
          {b.rationale && <p><span className="eyebrow">Rationale </span>{b.rationale}</p>}
          <p className="text-muted-foreground">{[b.visual_subject, b.environment, b.composition, [b.camera_angle, b.camera_distance, b.camera_movement].filter(Boolean).join(' / '), b.lighting, b.emotion].filter(Boolean).join(' · ')}</p>
          {b.continuity_notes && <p className="text-xs text-muted-foreground">Continuity: {b.continuity_notes}</p>}
          {qc ? <p className="text-xs" data-testid={`text-qc-${shot.id}`}>Quality {qc.score ?? 'n/a'}{qc.notes ? ` · ${qc.notes}` : ''}</p> : <p className="text-xs text-muted-foreground">Quality check missing for this version.</p>}
        </div>
      </div>
      {cur && <p className="text-xs tabular-nums text-muted-foreground" data-testid={`text-cost-${shot.id}`}>This version: estimated {money(cur.estimatedCost)} (reservation incl. QC), actual {cur.actualCost == null ? 'unknown (not zero)' : money(cur.actualCost)}</p>}
      <div className="flex flex-wrap gap-2">
        {!cur?.image_asset_id && !cur?.image_url && <button className="btn btn-sm" disabled={busy} onClick={() => act({ action: 'generate', runId, shotId: shot.id }, 'Generate this image? This is a paid call.')} data-testid={`button-generate-${shot.id}`}>Generate image</button>}
        {cur && <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => act({ action: 'regenerate', ...base }, 'Regenerate this shot as a new private image version? This is a paid call.')} data-testid={`button-regenerate-${shot.id}`}>Regenerate shot</button>}
        {cur && <button className="btn btn-sm" disabled={busy || approved || !qcPass(cur)} title={!qcPass(cur) ? 'Needs an image and a passing quality check (score 80+, all checks true)' : undefined} onClick={() => act({ action: 'approve', ...base })} data-testid={`button-approve-${shot.id}`}>{approved ? 'Approved' : 'Approve shot'}</button>}
        {cur && <button className="btn btn-sm btn-quiet" disabled={busy || !video?.available || !approved} title={!video?.available ? 'Video provider unavailable' : !approved ? 'Approve the image first' : undefined} onClick={() => act({ action: 'upgrade_video', ...base }, 'Upgrade this approved image to video? This is a paid call.')} data-testid={`button-video-${shot.id}`}>Upgrade to video</button>}
        {cur && <button className="btn btn-sm btn-quiet" onClick={() => setOpen(!open)} data-testid={`button-edit-${shot.id}`}>{open ? 'Close controls' : 'Change shot'}</button>}
      </div>
      {open && cur && (
        <div className="space-y-3 border p-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {sel('shot_type', b.shot_type, SHOT_TYPES, 'Shot type')}
            <label><span className="eyebrow">Composition</span><input className={field} placeholder={b.composition} value={ch.composition ?? ''} onChange={(e) => set('composition', e.target.value)} data-testid={`input-composition-${shot.id}`} /></label>
            {sel('camera_angle', b.camera_angle, ANGLES, 'Camera angle')}{sel('camera_distance', b.camera_distance, DISTANCES, 'Distance')}
            {sel('camera_movement', b.camera_movement, MOVES, 'Camera movement')}{sel('motion_recommendation', b.motion_recommendation, MOTIONS, 'Motion')}
          </div>
          <p className="text-xs text-muted-foreground">{content ? 'Shot type, composition, angle or distance changes create a new version that needs regeneration.' : 'Movement and motion changes keep the image and go to review.'}</p>
          <button className="btn btn-sm" disabled={busy || !Object.keys(ch).length} onClick={() => { act({ action: 'edit', ...base, changes: ch }); setCh({}); setOpen(false); }} data-testid={`button-save-edit-${shot.id}`}>Save as new version</button>
        </div>
      )}
    </li>
  );
}
