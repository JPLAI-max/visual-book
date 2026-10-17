import { useEffect, useRef } from 'react';
import { VideoCanvas, type VideoAspectRatio, useVideoPlayer, VideoPausedContext } from '@/lib/video';
import { AnimatePresence } from 'framer-motion';
import { IntroScene, HomeScene, BookScene, PlayerScene, OutroScene } from './scenes/Scenes';

export const SCENE_DURATIONS = { intro: 2500, home: 4000, book: 3300, player: 3200, outro: 2000 };
const SCENE_COMPONENTS: Record<string, React.ComponentType> = { intro: IntroScene, home: HomeScene, book: BookScene, player: PlayerScene, outro: OutroScene };
const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';
const SCENE_START_SEC: Record<string, number> = (() => { const o: Record<string, number> = {}; let c = 0; for (const [k, ms] of Object.entries(SCENE_DURATIONS)) { o[k] = c / 1000; c += ms; } return o; })();

export default function VideoTemplate({ durations = SCENE_DURATIONS, loop = true, paused = false, muted = false, onSceneChange }: {
  durations?: Record<string, number>; loop?: boolean; paused?: boolean; muted?: boolean; onSceneChange?: (k: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  useEffect(() => { onSceneChange?.(currentSceneKey); }, [currentSceneKey, onSceneChange]);
  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const Scene = SCENE_COMPONENTS[baseSceneKey];
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastRef = useRef<string | null>(null);
  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    a.volume = 0.5;
    if (paused) { a.pause(); return; }
    if (lastRef.current !== currentSceneKey) {
      lastRef.current = currentSceneKey;
      const t = SCENE_START_SEC[baseSceneKey] ?? 0;
      if (Math.abs(a.currentTime - t) > 0.18) a.currentTime = t;
    }
    a.play().catch(() => {});
  }, [currentSceneKey, baseSceneKey, muted, paused]);
  return (
    <VideoPausedContext.Provider value={paused}>
      <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO} className="grain" style={{ backgroundColor: 'var(--bg)' }}>
        <AnimatePresence mode="popLayout">{Scene && <Scene key={currentSceneKey} />}</AnimatePresence>
        <audio ref={audioRef} src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`} preload="auto" autoPlay muted={muted} />
      </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
