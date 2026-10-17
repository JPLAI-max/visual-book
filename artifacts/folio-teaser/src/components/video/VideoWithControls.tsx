import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Repeat, Volume2, VolumeX, ChevronDown, ChevronUp } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from './useSceneControls';

const F = 'src/components/video/scenes/Scenes.tsx';
const SCENE_DETAILS: Record<string, { title: string; filePath: string }> = {
  intro: { title: 'Opening', filePath: F }, home: { title: 'Catalog', filePath: F }, book: { title: 'Frankenstein', filePath: F },
  player: { title: 'Player', filePath: F }, outro: { title: 'Ending', filePath: F },
};
function announce(index: number, keys: string[]) {
  const d = SCENE_DETAILS[keys[index]]; if (!d?.filePath) return;
  window.parent.postMessage({ type: 'REPLIT_VIDEO_SCENE_SELECTED', payload: { sceneIndex: index, sceneCount: keys.length, sceneTitle: d.title, filePath: d.filePath, lineNumber: 1 } }, '*');
}
function fmt(ms: number) { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

function PlaybackStatus({ sceneKeys, activeIndex, activeDuration, activeStartTime, totalDuration, tick, paused, onJumpTo }: {
  sceneKeys: string[]; activeIndex: number; activeDuration: number; activeStartTime: number; totalDuration: number; tick: number; paused: boolean; onJumpTo: (i: number) => void; }) {
  const [elapsed, setElapsed] = useState(0);
  const baseRef = useRef(0);
  useEffect(() => { setElapsed(0); baseRef.current = 0; }, [tick]);
  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(baseRef.current + (performance.now() - start)), 60);
    return () => { window.clearInterval(id); baseRef.current += performance.now() - start; };
  }, [tick, paused]);
  const progress = activeDuration > 0 ? Math.min(1, elapsed / activeDuration) : 0;
  const total = Math.min(totalDuration, activeStartTime + Math.min(elapsed, activeDuration));
  return (<>
    <div className="flex-1 flex items-center gap-1.5">
      {sceneKeys.map((k, i) => (
        <button key={k} onClick={() => onJumpTo(i)} className="flex-1 h-3 bg-white/20 rounded-full overflow-hidden cursor-pointer hover:h-4 transition-all relative min-h-[12px]" aria-label={'Jump to scene ' + (i + 1)}>
          <div className="absolute inset-y-0 left-0 bg-white/90 rounded-full" style={{ width: (i === activeIndex ? progress * 100 : 0) + '%' }} />
        </button>))}
    </div>
    <div className="text-xl text-white/60 font-mono tabular-nums shrink-0">{activeIndex + 1}/{sceneKeys.length}</div>
    <div className="min-w-[11ch] text-right text-xl text-white/80 font-mono tabular-nums shrink-0" role="timer">{fmt(total)} / {fmt(totalDuration)}</div>
  </>);
}

const btn = 'w-14 h-14 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors rounded-lg shrink-0';

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;
  const c = useSceneControls(SCENE_DURATIONS);
  const { sceneKeys, jumpTo, paused } = c;
  const [muted, setMuted] = useState(false);
  const handleJumpTo = useCallback((i: number) => { jumpTo(i); announce(i, sceneKeys); }, [jumpTo, sceneKeys]);
  useEffect(() => {
    if (!paused) return;
    const frozen = document.getAnimations().filter((a) => a.playState === 'running');
    frozen.forEach((a) => a.pause());
    return () => frozen.forEach((a) => a.play());
  }, [paused]);
  const sensorRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const h = (e: PointerEvent) => { if (e.pointerType === 'mouse') return; if (sensorRef.current && !sensorRef.current.contains(e.target as Node)) setTapPinned(false); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [collapsed, tapPinned]);
  if (!isIframed) return <VideoTemplate />;
  const visible = !collapsed || hovering || tapPinned;
  return (
    <div className="relative w-full h-screen">
      <VideoTemplate key={c.mountKey} durations={c.durations} loop paused={paused} muted={muted} onSceneChange={c.onSceneChange} />
      <div ref={sensorRef} className="absolute bottom-0 left-0 right-0 z-50 flex flex-col justify-end" style={{ height: '25%' }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHovering(true); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHovering(false); }}
        onPointerDown={(e) => { if (e.pointerType !== 'mouse' && collapsed) setTapPinned(true); }}>
        <div className="flex-1 w-full" aria-hidden="true" />
        <div className={'flex items-center gap-3 bg-black/50 backdrop-blur-sm px-5 py-4 transition-all duration-200 ' + (visible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-full opacity-0 pointer-events-none')}>
          <button onClick={c.togglePause} className={btn} aria-label={paused ? 'Play' : 'Pause'}>{paused ? <Play className="w-8 h-8" /> : <Pause className="w-8 h-8" />}</button>
          <button onClick={c.toggleLock} className={btn + (c.locked ? ' text-white bg-white/15' : '')} aria-pressed={c.locked} aria-label="Loop current scene"><Repeat className="w-8 h-8" /></button>
          <button onClick={() => setMuted((m) => !m)} className={btn} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeX className="w-8 h-8" /> : <Volume2 className="w-8 h-8" />}</button>
          <div className="w-px self-stretch bg-white/15" />
          <PlaybackStatus sceneKeys={sceneKeys} activeIndex={c.activeIndex} activeDuration={c.activeDuration} activeStartTime={c.activeStartTime} totalDuration={c.totalDuration} tick={c.tick} paused={paused} onJumpTo={handleJumpTo} />
          <button onClick={() => setCollapsed((v) => { if (!v) { setHovering(false); setTapPinned(false); } return !v; })} className={btn} aria-label={collapsed ? 'Show controls' : 'Hide controls'}>
            {collapsed ? <ChevronUp className="w-10 h-10" /> : <ChevronDown className="w-10 h-10" />}
          </button>
        </div>
      </div>
    </div>
  );
}
