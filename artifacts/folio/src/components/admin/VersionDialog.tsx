import { useEffect, useState } from 'react';
import { useCreateSceneVersion } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useRefresh } from '@/lib/use-reader';
import { errMsg } from '@/lib/format';

export function VersionDialog({ open, onClose, sceneId, initial }: { open: boolean; onClose: () => void; sceneId: number; initial?: Record<string, unknown> }) {
  const [f, setF] = useState({ narration: '', imageUrl: '', videoUrl: '', audioUrl: '', captionUrl: '', notes: '' });
  useEffect(() => { if (open) setF({ narration: String(initial?.narration ?? ''), imageUrl: String(initial?.imageUrl ?? ''), videoUrl: String(initial?.videoUrl ?? ''), audioUrl: String(initial?.audioUrl ?? ''), captionUrl: String(initial?.captionUrl ?? ''), notes: '' }); }, [open, initial]);
  const m = useCreateSceneVersion();
  const refresh = useRefresh();
  const { toast } = useToast();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto rounded-xl bg-background">
        <DialogHeader><DialogTitle className="serif text-2xl font-normal">New scene version</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <textarea className="box min-h-28" placeholder="Narration" value={f.narration} onChange={set('narration')} data-testid="input-version-narration" />
          {(['imageUrl', 'videoUrl', 'audioUrl', 'captionUrl'] as const).map((k) => <input key={k} className="box" placeholder={k} value={f[k]} onChange={set(k)} data-testid={`input-version-${k}`} />)}
          <textarea className="box min-h-16" placeholder="Notes" value={f.notes} onChange={set('notes')} data-testid="input-version-notes" />
        </div>
        <button className="btn" disabled={!f.narration.trim() || m.isPending} data-testid="button-create-version"
          onClick={() => m.mutate({ id: sceneId, data: { ...f, notes: f.notes || undefined } }, { onSuccess: () => { toast({ title: 'Version created', description: 'Publish it from the version list.' }); refresh(); onClose(); }, onError: (e) => toast({ title: 'Could not create', description: errMsg(e), variant: 'destructive' }) })}>
          {m.isPending ? 'Saving' : 'Create version'}
        </button>
      </DialogContent>
    </Dialog>
  );
}
