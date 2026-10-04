import { Link, useParams } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { useGetBook } from '@workspace/api-client-react';
import { Player } from '@/components/player/Player';
import { Block, ErrorState, Message } from '@/components/States';
import { useReader } from '@/lib/use-reader';

export default function Watch() {
  const p = useParams();
  const bid = Number(p.bookId), cid = Number(p.chapterId);
  const { data, isLoading, isError, refetch } = useGetBook(bid);
  const { authed } = useReader();
  const chapter = data?.chapters.find((c) => c.id === cid);
  return (
    <div className="grain min-h-[100dvh] bg-background">
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-6 flex items-center justify-between">
          <Link href={`/books/${bid}`} className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground" data-testid="link-back-book">
            <ArrowLeft className="h-4 w-4" /> {data?.book.title ?? 'Book'}
          </Link>
          {chapter && <span className="eyebrow">Chapter {chapter.number} · {chapter.title}</span>}
        </div>
        {isLoading ? <><div className="aspect-video animate-pulse rounded bg-muted" /><div className="mt-8 max-w-md"><Block /></div></> :
          isError || !data ? <ErrorState onRetry={() => refetch()} what="this chapter" /> :
          !chapter || chapter.scenes.length === 0 || data.book.status !== 'published' ? <Message title="Not playable yet" body="This chapter has no published scenes." action={<Link href={`/books/${bid}`} className="btn">Back to the book</Link>} /> :
          <Player key={`${bid}-${cid}`} book={data.book} chapter={chapter} chapters={data.chapters} authed={authed} />}
      </div>
    </div>
  );
}
