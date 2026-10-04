import { Link } from 'wouter';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
export function SignInPrompt({ open, onClose, reason }: { open: boolean; onClose: () => void; reason: string }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm rounded-xl bg-background">
        <DialogHeader>
          <DialogTitle className="serif text-2xl font-normal">Sign in to continue</DialogTitle>
          <DialogDescription>{reason}</DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex gap-3">
          <Link href="/sign-in" className="btn" data-testid="link-prompt-sign-in">Sign in</Link>
          <Link href="/sign-up" className="btn btn-quiet" data-testid="link-prompt-sign-up">Create account</Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
