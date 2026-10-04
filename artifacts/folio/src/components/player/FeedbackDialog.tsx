import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useSubmitFeedback } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { errMsg } from '@/lib/format';

const UP = ['Beautiful image', 'Narration helped', 'Good pacing'];
const DOWN = ['Image did not fit', 'Narration unclear', 'Too fast', 'Too slow', 'Audio problem'];

export function FeedbackDialog({ open, onClose, bookId, chapterId, sceneId }: { open: boolean; onClose: () => void; bookId: number; chapterId: number; sceneId?: number }) {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const m = useSubmitFeedback();
  const { toast } = useToast();
  const send = () => {
    if (!rating) return;
    m.mutate({ data: { bookId, chapterId, sceneId, rating, feedbackType: reason || undefined, comment: comment.trim() || undefined } }, {
      onSuccess: () => { toast({ title: 'Thank you', description: 'Your note reaches the editors.' }); setRating(null); setReason(''); setComment(''); onClose(); },
      onError: (e) => toast({ title: 'Could not send', description: errMsg(e), variant: 'destructive' }),
    });
  };
  const reasons = rating === -1 ? DOWN : UP;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-xl bg-background">
        <DialogHeader>
          <DialogTitle className="serif text-2xl font-normal">How was this scene?</DialogTitle>
          <DialogDescription>A quiet note is enough.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-3">
          {([1, -1] as const).map((r) => (
            <button key={r} onClick={() => { setRating(r); setReason(''); }} data-testid={`button-rate-${r > 0 ? 'up' : 'down'}`}
              className={`flex h-12 w-12 items-center justify-center rounded-full border transition-all hover:scale-105 ${rating === r ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
              aria-label={r > 0 ? 'Good' : 'Not good'}>
              {r > 0 ? <ThumbsUp className="h-4 w-4" /> : <ThumbsDown className="h-4 w-4" />}
            </button>
          ))}
        </div>
        {rating && (
          <div className="rise space-y-4">
            <div className="flex flex-wrap gap-2">
              {reasons.map((x) => (
                <button key={x} onClick={() => setReason(reason === x ? '' : x)} data-testid={`chip-reason-${x}`}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${reason === x ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted'}`}>{x}</button>
              ))}
            </div>
            <textarea className="box min-h-20" placeholder="Anything else (optional)" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} data-testid="input-feedback-comment" />
          </div>
        )}
        <button className="btn" disabled={!rating || m.isPending} onClick={send} data-testid="button-send-feedback">{m.isPending ? 'Sending' : 'Send'}</button>
      </DialogContent>
    </Dialog>
  );
}
