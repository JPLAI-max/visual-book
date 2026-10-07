export interface Crop { x: number; y: number; width: number; height: number }
export type MotionType = 'STATIC' | 'PAN_ZOOM' | 'PARALLAX' | 'AI_VIDEO';
export type Preset = 'Slow Push In' | 'Slow Pull Out' | 'Pan Left' | 'Pan Right' | 'Pan Up' | 'Pan Down' | 'Static' | 'Parallax';
export type PanDir = 'left' | 'right' | 'up' | 'down' | 'none';
export type Transition = 'CUT' | 'FADE';
export interface Shot {
  id: string; assetId: number; start: number; duration: number; motionType: MotionType; preset: Preset;
  crop: Crop; zoomStart: number; zoomEnd: number; panDirection: PanDir; transitionIn: Transition; transitionOut: Transition; foregroundAssetId?: number;
}
export interface TimelineScene { id: number; title: string; narration: string; duration: number; audioAssetId: number; captionAssetId: number; shots: Shot[] }
export interface TAsset { id: number; kind: 'image' | 'video' | 'audio' | 'captions'; mime: string; url: string; name: string; foregroundApproved?: boolean }
export interface TRender { id: number; revision: number; status: 'queued' | 'rendering' | 'ready' | 'published' | 'failed'; asset_url?: string; caption_url?: string; error?: string }
export interface TimelineDoc { chapter: { id: number; title: string; book_id: number; duration: number }; revision: number; scenes: TimelineScene[]; assets: TAsset[]; renders: TRender[] }
export interface EditorChapter { id: number; title: string; book_title: string; book_id: number; duration: number }
export interface Insight { scene_id: number; title: string; question_count: number; common_question_topic: string; timestamp_cluster: number; unique_viewers: number; flagged: boolean }
export interface HistoryItem { question: string; answer: string; scene_id: number; timestamp: number; created_at: string }
export interface AskReply { answer: string; conversationId: string; citations: string[]; topic: string }

export const PRESETS: Record<Preset, { motionType: MotionType; zoomStart: number; zoomEnd: number; panDirection: PanDir }> = {
  'Slow Push In': { motionType: 'PAN_ZOOM', zoomStart: 1, zoomEnd: 1.1, panDirection: 'none' },
  'Slow Pull Out': { motionType: 'PAN_ZOOM', zoomStart: 1.1, zoomEnd: 1, panDirection: 'none' },
  'Pan Left': { motionType: 'PAN_ZOOM', zoomStart: 1.06, zoomEnd: 1.06, panDirection: 'left' },
  'Pan Right': { motionType: 'PAN_ZOOM', zoomStart: 1.06, zoomEnd: 1.06, panDirection: 'right' },
  'Pan Up': { motionType: 'PAN_ZOOM', zoomStart: 1.06, zoomEnd: 1.06, panDirection: 'up' },
  'Pan Down': { motionType: 'PAN_ZOOM', zoomStart: 1.06, zoomEnd: 1.06, panDirection: 'down' },
  Static: { motionType: 'STATIC', zoomStart: 1, zoomEnd: 1, panDirection: 'none' },
  Parallax: { motionType: 'PARALLAX', zoomStart: 1, zoomEnd: 1.08, panDirection: 'none' },
};
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const MIN_SHOT = 0.5;

export function normalize(s: TimelineScene): TimelineScene {
  let t = 0;
  return { ...s, shots: s.shots.map((sh) => { const o = { ...sh, start: r2(t) }; t += sh.duration; return o; }) };
}
export function sceneIssues(s: TimelineScene): string[] {
  const out: string[] = [];
  const sum = s.shots.reduce((n, x) => n + x.duration, 0);
  if (!s.shots.length) out.push('Scene needs at least one shot.');
  if (Math.abs(sum - s.duration) > 0.05) out.push(`Shots total ${sum.toFixed(2)}s but narration is ${s.duration.toFixed(2)}s (tolerance 0.05s).`);
  s.shots.forEach((x, i) => {
    const c = x.crop;
    if (c.x < 0 || c.y < 0 || c.width <= 0 || c.height <= 0 || c.x + c.width > 1.0001 || c.y + c.height > 1.0001) out.push(`Shot ${i + 1} crop must stay inside the frame (x+width and y+height at most 1).`); if (x.duration < MIN_SHOT) out.push(`Shot ${i + 1} is under ${MIN_SHOT}s.`); if (x.zoomStart < 1 || x.zoomEnd > 1.15 || x.zoomEnd < 1 || x.zoomStart > 1.15) out.push(`Shot ${i + 1} zoom must stay within 1 to 1.15.`); });
  return out;
}
export function fitToNarration(s: TimelineScene): TimelineScene {
  const n = s.shots.length; if (!n) return s;
  const sum = s.shots.reduce((a, x) => a + x.duration, 0) || 1;
  const k = s.duration / sum;
  const shots = s.shots.map((x) => ({ ...x, duration: Math.max(MIN_SHOT, r2(x.duration * k)) }));
  const rest = r2(s.duration - shots.slice(0, -1).reduce((a, x) => a + x.duration, 0));
  shots[n - 1].duration = Math.max(MIN_SHOT, rest);
  return normalize({ ...s, shots });
}
export function errMsg(e: unknown): string {
  const m = e as { message?: string; data?: { error?: string; message?: string } } | null;
  return m?.data?.error ?? m?.data?.message ?? m?.message ?? 'Request failed.';
}

export const isVisual = (a: TAsset) => a.kind === 'image' || a.kind === 'video';
/** Move the boundary between shot i and i+1 to absolute scene time `at`, preserving total and min length. */
export function moveBoundary(s: TimelineScene, i: number, at: number): TimelineScene {
  const a = s.shots[i], b = s.shots[i + 1]; if (!a || !b) return s;
  const lo = a.start + MIN_SHOT, hi = b.start + b.duration - MIN_SHOT;
  const v = r2(Math.min(hi, Math.max(lo, at)));
  const shots = s.shots.map((x, k) => (k === i ? { ...x, duration: r2(v - a.start) } : k === i + 1 ? { ...x, duration: r2(b.start + b.duration - v) } : x));
  return normalize({ ...s, shots });
}
