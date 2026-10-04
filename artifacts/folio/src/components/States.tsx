import type { ReactNode } from 'react';
export function GridSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[2/3] rounded-[3px] bg-muted" />
          <div className="mt-4 h-4 w-3/4 rounded bg-muted" />
          <div className="mt-2 h-3 w-1/2 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
export function Block({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: lines }).map((_, i) => <div key={i} className="h-4 rounded bg-muted" style={{ width: `${90 - i * 14}%` }} />)}
    </div>
  );
}
export function Message({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-24 text-center rise">
      <div className="mx-auto mb-8 h-px w-10 bg-foreground/40" />
      <h2 className="serif text-3xl">{title}</h2>
      {body && <p className="mt-3 text-muted-foreground">{body}</p>}
      {action && <div className="mt-8 flex justify-center gap-3">{action}</div>}
    </div>
  );
}
export function ErrorState({ onRetry, what = 'this' }: { onRetry: () => void; what?: string }) {
  return (
    <Message title="That did not load" body={`We could not reach ${what}. Nothing has been lost.`}
      action={<button className="btn" onClick={onRetry} data-testid="button-retry">Try again</button>} />
  );
}
