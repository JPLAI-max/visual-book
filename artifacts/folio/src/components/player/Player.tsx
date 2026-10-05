import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, ChevronLeft, ChevronRight, List, Maximize, Minimize, Pause, Play, Subtitles, Volume2, VolumeX } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRecordViewEvent, useSaveProgress, type Book, type Chapter, type EventInput } from '@workspace/api-client-react';
import { SignInPrompt } from '@/components/SignInPrompt';
import { FeedbackDialog } from './FeedbackDialog';
import { clock, label } from '@/lib/format';

const SPEEDS = [0.75, 1, 1.25, 1.5];

export function Player({ book, chapter, chapters, authed }: { book: Book; chapter: Chapter; chapters: Chapter[]; authed: boolean }) {
  const qc = useQueryClient();
  const scenes = useMemo(() => [...chapter.scenes].sort((a, b) => a.number - b.number), [chapter]);
  const starts = useMemo(() => { let t = 0; return scenes.map((s) => { const a = t; t += s.duration; return a; }); }, [scenes]);
  const total = useMemo(() => scenes.reduce((n, s) => n + s.duration, 0), [scenes]);
  const sceneAt = useCallback((p: number) => { let i = 0; starts.forEach((s, k) => { if (p >= s) i = k; }); return i; }, [starts]);

  const saved = book.progress && book.progress.chapterId === chapter.id && !book.progress.completedChapters.includes(chapter.id) ? Math.min(book.progress.position, Math.max(0, total - 0.1)) : 0;
  const [pos, setPos] = useState(saved);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(0.9);
  const [cc, setCc] = useState(true);
  const [list, setList] = useState(false);
  const [full, setFull] = useState(false);
  const [ended, setEnded] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [ui, setUi] = useState(true);
  const [feedback, setFeedback] = useState(false);
  const [prompt, setPrompt] = useState('');

  const posRef = useRef(saved);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const touched = useRef(false);
  const acc = useRef({ sceneId: 0, secs: 0 });
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const failedRef = useRef(false);
  const startedSceneRef = useRef<number | undefined>(undefined);
  const previousSceneRef = useRef<number | undefined>(undefined);
  failedRef.current = audioFailed;

  const idx = sceneAt(pos);
  const scene = scenes[idx];
  const sceneIdRef = useRef(scene?.id);
  sceneIdRef.current = scene?.id;

  const evMut = useRef(useRecordViewEvent().mutate);
  const progMut = useRef(useSaveProgress().mutate);
  const authedRef = useRef(authed);
  authedRef.current = authed;

  const sendEvent = useCallback((eventType: EventInput['eventType'], watchSeconds?: number, sceneId?: number) => {
    evMut.current({ data: { bookId: book.id, chapterId: chapter.id, sceneId: sceneId ?? sceneIdRef.current, eventType, position: Math.floor(posRef.current), watchSeconds } }, { onError: () => {} });
  }, [book.id, chapter.id]);
  const flush = useCallback(() => {
    const a = acc.current;
    if (a.secs >= 1) sendEvent('watch', Math.min(30, Math.round(a.secs)), a.sceneId);
    acc.current = { sceneId: sceneIdRef.current, secs: 0 };
  }, [sendEvent]);
  const save = useCallback((completed?: boolean) => {
    if (!authedRef.current || !touched.current) return;
    progMut.current({ data: { bookId: book.id, chapterId: chapter.id, position: Math.floor(posRef.current), completed } }, { onError: () => {} });
  }, [book.id, chapter.id]);

  const setPosition = (p: number) => { posRef.current = p; setPos(p); };
  const finish = useCallback(() => {
    playingRef.current = false; setPlaying(false); setEnded(true); setPosition(total);
    flush(); touched.current = true; save(true);
    sendEvent('scene_completed');
    sendEvent('chapter_completed');
    if (chapters[chapters.length - 1]?.id === chapter.id) sendEvent('book_completed');
    setTimeout(() => qc.invalidateQueries(), 600);
  }, [total, flush, save, sendEvent, chapters, chapter.id, qc]);
  const finishRef = useRef(finish); finishRef.current = finish;

  const setPlay = (v: boolean) => {
    if (v && ended) { setEnded(false); setPosition(0); }
    touched.current = true;
    if (v && startedSceneRef.current !== sceneIdRef.current) {
      sendEvent('scene_started');
      startedSceneRef.current = sceneIdRef.current;
    }
    playingRef.current = v; setPlaying(v);
    if (!v) { flush(); save(); qc.invalidateQueries(); }
  };

  // clock
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      acc.current.sceneId = sceneIdRef.current; acc.current.secs += 0.25;
      if (acc.current.secs >= 30) flush();
      const next = posRef.current + 0.25 * speedRef.current;
      if (next >= total) { finishRef.current(); return; }
      setPosition(next);
      const a = audioRef.current;
      if (a && !failedRef.current && !a.paused && !a.ended) {
        const want = next - starts[sceneAt(next)];
        if (Math.abs(a.currentTime - want) > 0.9 && a.duration > want) a.currentTime = want;
      }
    }, 250);
    return () => clearInterval(t);
  }, [playing, total, starts, sceneAt, flush]);

  // autosave every 5s
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => save(), 5000);
    return () => clearInterval(t);
  }, [playing, save]);

  // scene change: load audio
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !scene) return;
    flush();
    if (playingRef.current) {
      if (previousSceneRef.current && previousSceneRef.current !== scene.id) sendEvent('scene_completed', undefined, previousSceneRef.current);
      sendEvent('scene_started');
      startedSceneRef.current = scene.id;
    }
    previousSceneRef.current = scene.id;
    setAudioFailed(!scene.audioUrl && !scene.videoUrl);
    if (!scene.audioUrl) return;
    a.src = scene.audioUrl; a.load();
    const onMeta = () => {
      try { a.currentTime = Math.min(Math.max(0, posRef.current - starts[idx]), Math.max(0, (a.duration || 0) - 0.1)); } catch { /* noop */ }
      a.playbackRate = speedRef.current;
      if (playingRef.current) a.play().catch(() => setAudioFailed(true));
    };
    a.addEventListener('loadedmetadata', onMeta, { once: true });
    return () => a.removeEventListener('loadedmetadata', onMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, scene?.id]);

  useEffect(() => {
    const a = audioRef.current;
    if (a && !audioFailed && scene?.audioUrl) { if (playing) a.play().catch(() => setAudioFailed(true)); else a.pause(); }
    const v = videoRef.current;
    if (v) { if (playing) v.play().catch(() => {}); else v.pause(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
  useEffect(() => { speedRef.current = speed; if (audioRef.current) audioRef.current.playbackRate = speed; if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; if (videoRef.current) videoRef.current.volume = volume; }, [volume]);
  useEffect(() => { const v = videoRef.current; if (v && scene?.videoUrl) { try { v.currentTime = Math.max(0, posRef.current - starts[idx]); } catch { /* noop */ } if (playingRef.current) v.play().catch(() => {}); } }, [idx, scene?.videoUrl, starts]);

  const seek = (p: number) => {
    p = Math.min(Math.max(0, p), total - 0.5);
    if (p < posRef.current - 1) sendEvent('rewind');
    if (sceneAt(p) !== idx) {
      sendEvent(p > posRef.current ? 'scene_skipped' : 'scene_replayed');
      previousSceneRef.current = undefined;
    }
    touched.current = true; setEnded(false); flush(); setPosition(p);
    const i = sceneAt(p), a = audioRef.current;
    if (i === idx && a && !audioFailed) { try { a.currentTime = p - starts[i]; } catch { /* noop */ } }
    if (i === idx && videoRef.current) videoRef.current.currentTime = p - starts[i];
    save();
  };

  // exit / pagehide
  useEffect(() => {
    const beacon = () => {
      const a = acc.current;
      if (authedRef.current && touched.current) navigator.sendBeacon('/api/progress', new Blob([JSON.stringify({ bookId: book.id, chapterId: chapter.id, position: Math.floor(posRef.current) })], { type: 'application/json' }));
      if (a.secs >= 1) navigator.sendBeacon('/api/events', new Blob([JSON.stringify({ bookId: book.id, chapterId: chapter.id, sceneId: a.sceneId, eventType: 'watch', position: Math.floor(posRef.current), watchSeconds: Math.min(30, Math.round(a.secs)) })], { type: 'application/json' }));
      acc.current.secs = 0;
    };
    window.addEventListener('pagehide', beacon);
    return () => {
      window.removeEventListener('pagehide', beacon);
      if (touched.current) { flush(); save(); sendEvent('exit'); setTimeout(() => qc.invalidateQueries(), 400); }
    };
  }, [book.id, chapter.id, flush, save, sendEvent, qc]);

  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);

  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen(); else boxRef.current?.requestFullscreen?.(); };
  const wake = () => { setUi(true); clearTimeout(idleRef.current); idleRef.current = setTimeout(() => setUi(false), 3200); };
  const show = ui || !playing;

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA'].includes(t.tagName) && (t as HTMLInputElement).type !== 'range') return;
      if (e.key === ' ') { e.preventDefault(); setPlay(!playingRef.current); }
      else if (e.key === 'ArrowRight') seek(posRef.current + 10);
      else if (e.key === 'ArrowLeft') seek(posRef.current - 10);
      else if (e.key === 'f') toggleFull();
      else if (e.key === 'c') setCc((v) => !v);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const ci = chapters.findIndex((c) => c.id === chapter.id);
  const prev = chapters[ci - 1], next = chapters[ci + 1];
  const done = book.progress?.completedChapters ?? [];
  const retryAudio = () => { setAudioFailed(false); const a = audioRef.current; if (a && scene) { a.src = scene.audioUrl; a.load(); a.addEventListener('loadedmetadata', () => { a.currentTime = Math.max(0, posRef.current - starts[idx]); if (playingRef.current) a.play().catch(() => setAudioFailed(true)); }, { once: true }); } };

  if (!scene) return null;
  const ib = 'flex h-9 w-9 items-center justify-center rounded-full text-[hsl(40_33%_94%)] transition-all hover:bg-white/15 active:scale-90';
  return (
    <div>
      <div ref={boxRef} onMouseMove={wake} onMouseLeave={() => playing && setUi(false)} data-testid="player"
        className="group relative aspect-video w-full select-none overflow-hidden rounded-[4px] bg-[hsl(24_25%_8%)]" style={{ cursor: show ? 'default' : 'none' }}>
        <audio ref={audioRef} preload="auto" onError={() => setAudioFailed(true)} />
        {scene.videoUrl ? (
          <video key={scene.id} ref={videoRef} src={scene.videoUrl} muted={!!scene.audioUrl} playsInline className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <img key={scene.id} src={scene.imageUrl} alt={scene.title} className={`kb fade absolute inset-0 h-full w-full object-cover`} style={{ animationPlayState: playing ? 'running' : 'paused', animationDuration: `${Math.max(scene.duration, 20) * 1.4}s` }} />
        )}
        <button className="absolute inset-0 h-full w-full" onClick={() => setPlay(!playing)} aria-label={playing ? 'Pause' : 'Play'} data-testid="button-stage" />
        {!playing && !ended && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center fade">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[hsl(40_33%_94%/.92)] text-[hsl(24_22%_12%)]"><Play className="ml-1 h-7 w-7" /></div>
          </div>
        )}
        {ended && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[hsl(24_25%_8%/.78)] fade text-[hsl(40_33%_94%)]">
            <p className="serif text-4xl">Chapter complete</p>
            <div className="flex gap-3">
              <button className="btn" onClick={() => setPlay(true)} data-testid="button-replay">Watch again</button>
              {next && <Link href={`/watch/${book.id}/${next.id}`} className="btn btn-quiet !text-[hsl(40_33%_94%)]" data-testid="link-next-chapter-end">Next chapter</Link>}
            </div>
          </div>
        )}
        {audioFailed && (
          <div className="absolute left-4 top-4 flex items-center gap-3 rounded-full bg-[hsl(24_25%_8%/.8)] py-1.5 pl-3 pr-2 text-xs text-[hsl(40_33%_94%)]" data-testid="status-audio-failed">
            <AlertTriangle className="h-3.5 w-3.5" /> Narration unavailable. Visuals continue.
            <button onClick={retryAudio} className="rounded-full bg-white/15 px-3 py-1 hover:bg-white/25" data-testid="button-retry-audio">Retry</button>
          </div>
        )}
        {cc && (
          <div className={`pointer-events-none absolute inset-x-0 flex justify-center px-8 transition-all duration-500 ${show ? 'bottom-24' : 'bottom-8'}`}>
            <p className="max-w-3xl rounded bg-[hsl(24_25%_8%/.7)] px-4 py-2 text-center text-sm leading-relaxed text-[hsl(40_33%_94%)] sm:text-base" data-testid="text-caption">{(() => {
              const lines = scene.narration.match(/[^.!?]+[.!?]+/g) ?? [scene.narration];
              return lines[Math.min(lines.length - 1, Math.floor((pos - starts[idx]) / scene.duration * lines.length))]?.trim();
            })()}</p>
          </div>
        )}
        <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[hsl(24_25%_6%/.85)] to-transparent px-4 pb-3 pt-14 transition-opacity duration-500 ${show ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          <div className="relative">
            <input type="range" className="scrub" min={0} max={total} step={0.5} value={pos} onChange={(e) => seek(Number(e.target.value))} aria-label="Seek" data-testid="input-scrub" />
          </div>
          <div className="relative mt-2 flex items-center gap-1">
            {prev ? <Link href={`/watch/${book.id}/${prev.id}`} className={ib} aria-label="Previous chapter" data-testid="link-prev-chapter"><ChevronLeft className="h-5 w-5" /></Link> : <span className={`${ib} opacity-30`}><ChevronLeft className="h-5 w-5" /></span>}
            <button className={ib} onClick={() => setPlay(!playing)} aria-label={playing ? 'Pause' : 'Play'} data-testid="button-play">{playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}</button>
            {next ? <Link href={`/watch/${book.id}/${next.id}`} className={ib} aria-label="Next chapter" data-testid="link-next-chapter"><ChevronRight className="h-5 w-5" /></Link> : <span className={`${ib} opacity-30`}><ChevronRight className="h-5 w-5" /></span>}
            <span className="ml-2 text-xs tabular-nums text-[hsl(40_33%_94%)]" data-testid="text-time">{clock(pos)} / {clock(total)}</span>
            <div className="flex-1" />
            <button className={ib} onClick={() => setVolume(volume ? 0 : 0.9)} aria-label="Mute">{volume ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button>
            <input type="range" className="scrub hidden !w-20 sm:block" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" data-testid="input-volume" />
            <button className="mx-1 h-9 min-w-[3rem] rounded-full px-2 text-xs text-[hsl(40_33%_94%)] hover:bg-white/15" onClick={() => { const n = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(n); sendEvent('speed_changed'); }} data-testid="button-speed">{speed}x</button>
            <button className={`${ib} ${cc ? 'bg-white/20' : ''}`} onClick={() => setCc(!cc)} aria-label="Captions" data-testid="button-cc"><Subtitles className="h-4 w-4" /></button>
            <button className={ib} onClick={() => setList(!list)} aria-label="Chapters" data-testid="button-chapters"><List className="h-4 w-4" /></button>
            <button className={ib} onClick={toggleFull} aria-label="Fullscreen" data-testid="button-fullscreen">{full ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}</button>
          </div>
        </div>
        {list && (
          <aside className="absolute inset-y-0 right-0 w-72 max-w-[80%] overflow-y-auto bg-[hsl(24_25%_8%/.94)] p-5 text-[hsl(40_33%_94%)] fade" data-testid="panel-chapters">
            <p className="eyebrow !text-[hsl(40_33%_94%/.6)]">Chapters</p>
            <ul className="mt-4 space-y-1">
              {chapters.map((c) => (
                <li key={c.id}>
                  {c.scenes.length ? (
                    <Link href={`/watch/${book.id}/${c.id}`} className={`block rounded px-3 py-2 text-sm transition-colors hover:bg-white/10 ${c.id === chapter.id ? 'bg-white/10' : ''}`} data-testid={`link-chapter-${c.id}`}>
                      <span className="opacity-60">{c.number}.</span> {c.title}{done.includes(c.id) && <span className="ml-2 text-xs opacity-60">watched</span>}
                    </Link>
                  ) : <span className="block px-3 py-2 text-sm opacity-40">{c.number}. {c.title}</span>}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-2xl">
          <p className="eyebrow">Scene {scene.number} of {scenes.length} · {label(scene.purpose)}</p>
          <h2 className="serif mt-2 text-3xl" data-testid="text-scene-title">{scene.title}</h2>
          <p className="mt-3 text-sm text-muted-foreground">{chapter.summary}</p>
        </div>
        <div className="flex gap-3">
          <button className="btn btn-quiet btn-sm" onClick={() => authed ? setFeedback(true) : setPrompt('Sign in to leave feedback on a scene.')} data-testid="button-feedback">Feedback</button>
          {!authed && <button className="btn btn-quiet btn-sm" onClick={() => setPrompt('Sign in to save your place and resume on any device.')} data-testid="button-save-place">Save my place</button>}
        </div>
      </div>
      {book.sample && <p className="mt-8 border-l-2 border-primary/60 pl-4 text-xs text-muted-foreground" data-testid="text-sample-label">
        Sample visual edition: timed images with narrated, original explanatory text. Not a full finished AI video.{!authed && ' Guest preview. Progress is not saved.'}
      </p>}
      <FeedbackDialog open={feedback} onClose={() => setFeedback(false)} bookId={book.id} chapterId={chapter.id} sceneId={scene.id} />
      <SignInPrompt open={!!prompt} onClose={() => setPrompt('')} reason={prompt} />
    </div>
  );
}
