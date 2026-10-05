import type { R } from './util';

export function PreviewDialog({ scene, take, onClose }: { scene: R; take: R; onClose: () => void }) {
  const narr = take.narration ?? scene.data?.narration;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4" role="dialog" aria-modal="true" data-testid="dialog-preview" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-3xl overflow-auto rounded bg-background p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex justify-between"><p className="serif text-2xl">Scene {scene.scene_number} · take {take.version_number}</p><button className="btn btn-sm btn-quiet" onClick={onClose} data-testid="button-close-preview">Close</button></div>
        {take.video_url ? (
          <video className="w-full bg-muted" controls src={take.video_url} poster={take.image_url ?? undefined} data-testid="video-preview" crossOrigin="anonymous">
            {take.caption_url && <track kind="captions" src={take.caption_url} srcLang="en" label="English" default />}
          </video>
        ) : take.image_url ? <img className="w-full" src={take.image_url} alt="Scene take" data-testid="img-preview" /> : <p className="text-sm text-muted-foreground">No visual generated for this take.</p>}
        {take.audio_url ? <audio className="mt-4 w-full" controls src={take.audio_url} data-testid="audio-preview" /> : <p className="mt-4 text-sm text-muted-foreground">No narration audio for this take.</p>}
        <p className="mt-4 whitespace-pre-wrap text-sm" data-testid="text-preview-narration">{narr || 'No narration text.'}</p>
      </div>
    </div>
  );
}
