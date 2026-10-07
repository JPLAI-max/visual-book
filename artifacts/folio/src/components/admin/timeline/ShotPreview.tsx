import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { Shot, TAsset, TimelineScene } from './types';

interface Seg { scene: TimelineScene; shot: Shot; abs: number; dur: number }
interface Cue { a: number; b: number; text: string }
const ts = (v: string) => { const p = v.trim().replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
function parseVtt(txt: string): Cue[] {
  return txt.split(/\r?\n\r?\n/).flatMap((b) => {
    const l = b.split(/\r?\n/); const i = l.findIndex((x) => x.includes('-->')); if (i < 0) return [];
    const [a, c] = l[i].split('-->'); return [{ a: ts(a), b: ts(c.trim().split(' ')[0]), text: l.slice(i + 1).join(' ') }];
  });
}

export function ShotPreview({ scenes, assets, label }: { scenes: TimelineScene[]; assets: TAsset[]; label: string }) {
  const segs = useMemo<Seg[]>(() => { let t = 0; return scenes.flatMap((scene) => scene.shots.map((shot) => { const s = { scene, shot, abs: t, dur: shot.duration }; t += shot.duration; return s; })); }, [scenes]);
  const total = segs.reduce((n, s) => n + s.dur, 0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cues, setCues] = useState<Record<number, Cue[]>>({});
  const [capErr, setCapErr] = useState<Record<number, string>>({});
  const [audioErr, setAudioErr] = useState('');
  const vid = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const amap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const key = segs.map((s) => s.shot.id).join('|');
  useEffect(() => { setT(0); setPlaying(false); }, [key]);
  useEffect(() => {
    const ids = [...new Set(scenes.map((s) => s.captionAssetId).filter((i) => i && !cues[i]))];
    ids.forEach((id) => {
      const u = amap.get(id)?.url; const bad = (m: string) => { setCues((c) => ({ ...c, [id]: [] })); setCapErr((c) => ({ ...c, [id]: m })); };
      if (!u) return bad('Caption asset is missing from this chapter.');
      fetch(u, { credentials: 'include' }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then((x) => { const k = parseVtt(x); setCues((c) => ({ ...c, [id]: k })); if (!k.length) setCapErr((c) => ({ ...c, [id]: 'Caption file has no cues.' })); })
        .catch((e) => bad(`Captions could not be loaded (${e instanceof Error ? e.message : 'network error'}).`));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, amap]);
  useEffect(() => {
    if (!playing) return;
    const i = setInterval(() => setT((v) => { if (v + 0.1 >= total) { setPlaying(false); return total; } return v + 0.1; }), 100);
    return () => clearInterval(i);
  }, [playing, total]);

  const cur = segs.find((s) => t >= s.abs && t < s.abs + s.dur) ?? segs[segs.length - 1];
  const rel = cur ? cur.shot.start + (t - cur.abs) : 0;
  const audioUrl = cur ? amap.get(cur.scene.audioAssetId)?.url : undefined;
  const curAsset = cur ? amap.get(cur.shot.assetId) : undefined;
  useEffect(() => { setAudioErr(''); }, [audioUrl]);
  useEffect(() => {
    const v = vid.current; if (!v) return;
    if (!playing) { v.pause(); return; }
    v.play().catch(() => {});
  }, [playing, cur?.shot.id]);
  useEffect(() => {
    const v = vid.current; if (!v || !curAsset || curAsset.kind !== 'video') return;
    const want = Math.max(0, t - (cur?.abs ?? 0));
    if (!playing || Math.abs(v.currentTime - want) > 0.6) { try { v.currentTime = v.duration ? Math.min(want, v.duration - 0.05) : want; } catch { /* noop */ } }
  }, [Math.floor(t * 4), cur?.shot.id, playing]);
  useEffect(() => {
    const a = audio.current; if (!a) return;
    if (!playing || !audioUrl) { a.pause(); return; }
    if (!a.src.endsWith(audioUrl) && a.src !== audioUrl) a.src = audioUrl;
    if (Math.abs(a.currentTime - rel) > 0.6) { try { a.currentTime = rel; } catch { /* noop */ } }
    a.play().catch((e) => setAudioErr(`Narration could not play (${e instanceof Error ? e.message : 'blocked'}).`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, audioUrl, cur?.shot.id, Math.floor(t)]);

  if (!cur) return <p className="text-sm text-muted-foreground">No shots to preview.</p>;
  const asset = amap.get(cur.shot.assetId);
  const fg = cur.shot.motionType === 'PARALLAX' ? amap.get(cur.shot.foregroundAssetId ?? -1) : undefined;
  const p = Math.min(1, Math.max(0, (t - cur.abs) / cur.dur));
  const { crop: c, zoomStart: zs, zoomEnd: ze, panDirection: d } = cur.shot;
  const still = cur.shot.motionType === 'STATIC';
  const zoom = (still ? zs : zs + (ze - zs) * p) / Math.max(0.2, Math.max(c.width, c.height));
  const mv = still ? 0 : (p - 0.5) * Math.min(6, Math.max(0, (zoom - 1) * 100));
  const tx = d === 'left' ? mv : d === 'right' ? -mv : 0, ty = d === 'up' ? mv : d === 'down' ? -mv : 0;
  const left = cur.dur - (t - cur.abs), loc = t - cur.abs;
  const op = cur.shot.transitionIn === 'FADE' && loc < 0.25 ? loc / 0.25 : cur.shot.transitionOut === 'FADE' && left < 0.25 ? left / 0.25 : 1;
  const style = { transformOrigin: `${(c.x + c.width / 2) * 100}% ${(c.y + c.height / 2) * 100}%`, transform: `translate(${tx}%, ${ty}%) scale(${zoom})`, opacity: op, transition: 'transform .1s linear, opacity .1s linear' };
  const cueList = cues[cur.scene.captionAssetId] ?? [];
  const cue = cueList.find((k) => rel >= k.a && rel <= k.b);
  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-[4px] bg-[hsl(24_25%_8%)]" data-testid="timeline-preview">
        <audio ref={audio} preload="auto" onError={() => setAudioErr('Narration audio failed to load.')} />
        {asset?.kind === 'video' ? <video key={asset.id} ref={vid} src={asset.url} muted playsInline className="absolute inset-0 h-full w-full object-cover" style={{ opacity: op }} />
          : asset ? <img src={asset.url} alt={cur.scene.title} className="absolute inset-0 h-full w-full object-cover" style={style} /> : <div className="absolute inset-0 flex items-center justify-center text-xs text-[hsl(40_33%_94%/.6)]">Asset missing</div>}
        {fg && <img src={fg.url} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ transform: `translateX(${-mv * 1.6}%) scale(${1 + p * 0.04})`, opacity: op, transition: 'transform .1s linear' }} />}
        {cue && <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-6"><p className="max-w-xl rounded bg-[hsl(24_25%_8%/.7)] px-3 py-1.5 text-center text-sm text-[hsl(40_33%_94%)]">{cue.text}</p></div>}
        {(!audioUrl || audioErr) && <span className="absolute left-3 top-3 rounded-full bg-[hsl(24_25%_8%/.8)] px-3 py-1 text-xs text-[hsl(40_33%_94%)]">{audioErr || 'No narration asset for this scene'}</span>}
      </div>
      {capErr[cur.scene.captionAssetId] && <p role="alert" className="mt-2 text-xs text-destructive">{capErr[cur.scene.captionAssetId]}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button className="btn btn-sm btn-quiet" onClick={() => { if (t >= total - 0.1) setT(0); setPlaying(!playing); }} data-testid="button-preview-play">{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{playing ? 'Pause' : `Preview ${label}`}</button>
        <input type="range" className="scrub flex-1" min={0} max={total} step={0.1} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} aria-label="Preview position" />
        <span className="text-xs tabular-nums text-muted-foreground">{t.toFixed(1)} / {total.toFixed(1)}s</span>
      </div>
    </div>
  );
}
