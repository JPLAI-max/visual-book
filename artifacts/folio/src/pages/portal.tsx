import { Link } from 'wouter';
import { useGetHome } from '@workspace/api-client-react';
import { Shell } from '@/components/Shell';
import { Catalog } from '@/components/Catalog';
import { BookCard } from '@/components/BookCard';
import { Cover } from '@/components/Cover';
import { Block, ErrorState } from '@/components/States';
import { useReader } from '@/lib/use-reader';
import { clock } from '@/lib/format';

export default function Portal() {
  const { me } = useReader();
  const { data, isLoading, isError, refetch } = useGetHome();
  return (
    <Shell>
      <div className="pb-16 pt-10">
        <p className="eyebrow rise">Welcome back{me?.displayName ? `, ${me.displayName}` : ''}</p>
        {isLoading ? <div className="mt-10 max-w-md"><Block /></div> : isError ? <ErrorState onRetry={() => refetch()} what="your reading" /> : (
          <>
            {data && data.continuing.length > 0 ? (
              <div className="mt-8 divide-y border-y">
                {data.continuing.map((b) => (
                  <Link key={b.id} href={b.progress ? `/watch/${b.id}/${b.progress.chapterId}` : `/books/${b.id}`} data-testid={`row-continue-${b.id}`}
                    className="group flex items-center gap-6 py-6 transition-colors hover:bg-muted/50">
                    <Cover src={b.coverImage} title={b.title} className="w-16 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="eyebrow">Continue</p>
                      <h2 className="serif truncate text-3xl">{b.title}</h2>
                      <p className="text-sm text-muted-foreground">{b.progress ? `${b.progress.chapterTitle} · resume at ${clock(b.progress.position)}` : b.author}</p>
                    </div>
                    <span className="btn btn-quiet btn-sm hidden transition-transform group-hover:translate-x-1 sm:inline-flex">Resume</span>
                  </Link>
                ))}
              </div>
            ) : (
              <h1 className="serif mt-4 text-5xl">Nothing in progress.<br /><em className="text-muted-foreground">Pick something below.</em></h1>
            )}
            {data && data.library.length > 0 && (
              <div className="mt-20">
                <div className="mb-8 flex items-baseline justify-between"><h2 className="serif text-3xl">Your library</h2><Link href="/library" className="text-sm text-muted-foreground hover:text-foreground">All saved</Link></div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-4">{data.library.slice(0, 4).map((b, i) => <BookCard key={b.id} book={b} i={i} />)}</div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="mt-8 border-t pt-20"><Catalog /></div>
    </Shell>
  );
}
