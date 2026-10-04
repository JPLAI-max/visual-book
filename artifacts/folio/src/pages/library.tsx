import { Link } from 'wouter';
import { useGetLibrary, useRemoveLibraryBook, getGetLibraryQueryKey } from '@workspace/api-client-react';
import { Shell } from '@/components/Shell';
import { BookCard } from '@/components/BookCard';
import { GridSkeleton, ErrorState, Message } from '@/components/States';
import { useRefresh, useReader } from '@/lib/use-reader';
import { useToast } from '@/hooks/use-toast';
import { errMsg } from '@/lib/format';

export default function Library() {
  const { authed, loading } = useReader();
  const { data, isLoading, isError, refetch } = useGetLibrary({ query: { enabled: authed, queryKey: getGetLibraryQueryKey() } });
  const rm = useRemoveLibraryBook();
  const refresh = useRefresh();
  const { toast } = useToast();
  if (!loading && !authed) return <Shell><Message title="Your library is private" body="Sign in to keep books close." action={<Link href="/sign-in" className="btn">Sign in</Link>} /></Shell>;
  return (
    <Shell>
      <h1 className="serif rise mt-10 text-5xl">Library</h1>
      <div className="mt-14">
        {isLoading || loading ? <GridSkeleton n={4} /> : isError ? <ErrorState onRetry={() => refetch()} what="your library" /> : data && data.length ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-14 sm:grid-cols-3 lg:grid-cols-4">
            {data.map((b, i) => (
              <div key={b.id}>
                <BookCard book={b} i={i} />
                <button className="mt-2 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-destructive hover:underline" data-testid={`button-remove-${b.id}`}
                  onClick={() => rm.mutate({ bookId: b.id }, { onSuccess: () => { refresh(); toast({ title: 'Removed from library' }); }, onError: (e) => toast({ title: 'Could not remove', description: errMsg(e), variant: 'destructive' }) })}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Message title="Nothing saved yet" body="Save a book from its page and it will wait for you here." action={<Link href="/" className="btn" data-testid="link-browse">Browse the catalog</Link>} />
        )}
      </div>
    </Shell>
  );
}
