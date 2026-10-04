import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useListBooks } from '@workspace/api-client-react';
import { BookCard } from './BookCard';
import { GridSkeleton, ErrorState } from './States';
import { RequestDialog } from './RequestDialog';

export function Catalog() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [req, setReq] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data, isLoading, isError, refetch } = useListBooks(dq ? { q: dq } : undefined);
  return (
    <section>
      <div className="relative mx-auto max-w-2xl">
        <Search className="absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="What book do you want to see?"
          className="serif w-full border-b border-input bg-transparent py-4 pl-9 text-2xl outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground sm:text-3xl"
          data-testid="input-search" aria-label="Search books" />
      </div>
      <div className="mt-20">
        {isLoading ? <GridSkeleton /> : isError ? <ErrorState onRetry={() => refetch()} what="the catalog" /> : data && data.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-14 sm:grid-cols-3 lg:grid-cols-4">
            {data.map((b, i) => <BookCard key={b.id} book={b} i={i} />)}
          </div>
        ) : (
          <div className="mx-auto max-w-md py-12 text-center rise" data-testid="empty-search">
            <h2 className="serif text-3xl">Not in the catalog yet</h2>
            <p className="mt-3 text-muted-foreground">Ask for "{dq}" and we will review its rights before anything is made.</p>
            <button className="btn mt-8" onClick={() => setReq(true)} data-testid="button-request-title">Request this title</button>
          </div>
        )}
      </div>
      {data && data.length > 0 && (
        <p className="mt-16 text-center text-sm text-muted-foreground">
          Looking for something else?{' '}
          <button className="underline underline-offset-4 transition-colors hover:text-foreground" onClick={() => setReq(true)} data-testid="button-request-other">Request a title</button>
        </p>
      )}
      <RequestDialog open={req} onClose={() => setReq(false)} initialTitle={dq} />
    </section>
  );
}
