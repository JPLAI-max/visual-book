import { useEffect, useState } from 'react';
import { useRequestBook } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useReader, useRefresh } from '@/lib/use-reader';
import { errMsg } from '@/lib/format';
import { SignInPrompt } from './SignInPrompt';

export function RequestDialog({ open, onClose, initialTitle = '', bookId }: { open: boolean; onClose: () => void; initialTitle?: string; bookId?: number }) {
  const { authed } = useReader();
  const [title, setTitle] = useState(initialTitle);
  const [author, setAuthor] = useState('');
  const m = useRequestBook();
  const refresh = useRefresh();
  const { toast } = useToast();
  useEffect(() => { if (open) setTitle(initialTitle); }, [open, initialTitle]);
  if (open && !authed) return <SignInPrompt open onClose={onClose} reason="Requests are recorded against your account so we can tell you when a title is reviewed." />;
  const submit = () => {
    if (!title.trim()) return;
    m.mutate({ data: { title: title.trim(), author: author.trim() || undefined, bookId } }, {
      onSuccess: () => { toast({ title: 'Request recorded', description: 'It goes to rights review first. Nothing is generated yet.' }); refresh(); setAuthor(''); onClose(); },
      onError: (e) => toast({ title: 'Could not record request', description: errMsg(e), variant: 'destructive' }),
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-xl bg-background">
        <DialogHeader>
          <DialogTitle className="serif text-2xl font-normal">Request a book</DialogTitle>
          <DialogDescription>We record demand and review rights before anything is made.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <input className="field" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-request-title" />
          <input className="field" placeholder="Author (optional)" value={author} onChange={(e) => setAuthor(e.target.value)} data-testid="input-request-author" />
          <button className="btn" disabled={!title.trim() || m.isPending} onClick={submit} data-testid="button-submit-request">{m.isPending ? 'Sending' : 'Send request'}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
