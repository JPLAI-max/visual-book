import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { Check, Plus } from 'lucide-react';
import { useGetBook, useSaveLibraryBook, useRemoveLibraryBook } from '@workspace/api-client-react';
import { Shell } from '@/components/Shell';
import { Cover } from '@/components/Cover';
import { playable } from '@/components/BookCard';
import { Block, ErrorState, Message } from '@/components/States';
import { SignInPrompt } from '@/components/SignInPrompt';
import { RequestDialog } from '@/components/RequestDialog';
import { useReader, useRefresh } from '@/lib/use-reader';
import { useToast } from '@/hooks/use-toast';
import { clock, errMsg, human, label } from '@/lib/format';

export default function BookPage() {
  const id = Number(useParams().id);
  const { data, isLoading, isError, refetch } = useGetBook(id);
  const { authed } = useReader();
  const save = useSaveLibraryBook();
  const rm = useRemoveLibraryBook();
  const refresh = useRefresh();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState(false);
  const [req, setReq] = useState(false);
  if (isLoading) return <Shell><div className="grid gap-12 pt-10 md:grid-cols-[280px_1fr]"><div className="aspect-[2/3] animate-pulse rounded bg-muted" /><Block lines={6} /></div></Shell>;
  if (isError || !data) return <Shell><ErrorState onRetry={() => refetch()} what="this book" /></Shell>;
  const { book, chapters } = data;
  const ok = playable(book);
  const p = book.progress;
  const toggle = () => {
    if (!authed) return setPrompt(true);
    const m = book.saved ? rm : save;
    m.mutate({ bookId: book.id }, {
      onSuccess: () => { refresh(); toast({ title: book.saved ? 'Removed from library' : 'Saved to library' }); },
      onError: (e) => toast({ title: 'Could not update library', description: errMsg(e), variant: 'destructive' }),
    });
  };
  const first = chapters.find((c) => c.scenes.length > 0);
  return (
    <Shell>
      <div className="grid gap-12 pt-8 md:grid-cols-[280px_1fr] md:gap-20">
        <div className="rise"><Cover src={book.coverImage} title={book.title} className="shadow-[0_30px_50px_-30px_hsl(24_30%_20%/.6)]" /></div>
        <div className="rise" style={{ animationDelay: '100ms' }}>
          <p className="eyebrow">{book.genre} · {book.year}</p>
          <h1 className="serif mt-3 text-5xl leading-none sm:text-6xl" data-testid="text-book-title">{book.title}</h1>
          {book.subtitle && <p className="serif mt-2 text-xl italic text-muted-foreground">{book.subtitle}</p>}
          <p className="mt-3 text-muted-foreground">{book.author}</p>
          <p className="mt-8 max-w-xl leading-relaxed">{book.description}</p>
          <p className="mt-6 text-xs text-muted-foreground">Rights: {label(book.rightsStatus)}{book.rightsNotes ? ` — ${book.rightsNotes}` : ''}</p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            {ok && first && (
              <Link href={`/watch/${book.id}/${p ? p.chapterId : first.id}`} className="btn" data-testid="button-start">
                {p && p.percentage < 100 ? `Continue Chapter ${chapters.find(c => c.id === p.chapterId)?.number ?? 1} — ${clock(p.position)}` : 'Start watching'}
              </Link>
            )}
            {!ok && ['public_domain', 'owned', 'licensed'].includes(book.rightsStatus) && <button className="btn" onClick={() => setReq(true)} data-testid="button-request-book">Request visual edition</button>}
            <button className="btn btn-quiet" onClick={toggle} disabled={save.isPending || rm.isPending} data-testid="button-save">
              {book.saved ? <><Check className="h-4 w-4" /> Saved</> : <><Plus className="h-4 w-4" /> Save</>}
            </button>
          </div>
          {ok && book.sample && <p className="mt-6 max-w-md border-l-2 border-primary/60 pl-4 text-sm text-muted-foreground" data-testid="text-sample-label">
            Sample visual edition: narrated stills with original explanatory text. This is not a finished AI-generated film.</p>}
          <p className="mt-4 text-xs text-muted-foreground">Visual edition · {label(book.status)}{p && p.percentage < 100 ? ` · ${Math.round(p.percentage)}% watched` : ''}</p>
        </div>
      </div>

      <section className="mt-24 max-w-3xl">
        <div className="flex items-baseline justify-between border-b pb-4"><h2 className="serif text-3xl">Chapters</h2>{ok && <span className="text-sm text-muted-foreground">{human(book.duration)}</span>}</div>
        {!ok ? (
          <Message title={book.status === 'requested' ? 'Requested' : 'Being planned'} body="This book is in rights review or planning. It is not playable yet, and nothing is being generated automatically." />
        ) : chapters.length === 0 ? <Message title="No chapters yet" /> : (
          <ol>
            {chapters.map((c) => {
              const done = p?.completedChapters.includes(c.id);
              const live = c.scenes.length > 0;
              const row = (
                <div className="group flex items-start gap-6 border-b py-6 transition-colors hover:bg-muted/40">
                  <span className="serif w-10 text-3xl text-muted-foreground/60">{String(c.number).padStart(2, '0')}</span>
                  <div className="flex-1">
                    <h3 className="serif text-2xl">{c.title}</h3>
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">{c.summary}</p>
                    {p?.chapterId === c.id && <p className="mt-2 text-xs text-primary">Resume at {clock(p.position)}</p>}
                  </div>
                  <span className="pt-2 text-xs text-muted-foreground">{done ? 'Watched' : live ? human(c.duration) : label(c.status)}</span>
                </div>
              );
              return <li key={c.id} data-testid={`row-chapter-${c.id}`}>{live ? <Link href={`/watch/${book.id}/${c.id}`}>{row}</Link> : <div className="opacity-50">{row}</div>}</li>;
            })}
          </ol>
        )}
      </section>
      <SignInPrompt open={prompt} onClose={() => setPrompt(false)} reason="Sign in to save books to your library." />
      <RequestDialog open={req} onClose={() => setReq(false)} initialTitle={book.title} bookId={book.id} />
    </Shell>
  );
}
