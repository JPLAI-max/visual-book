import { Link } from 'wouter';
import type { Book } from '@workspace/api-client-react';
import { Cover } from './Cover';
import { human, label } from '@/lib/format';

export const playable = (b: Book) => b.status === 'published' && b.chapterCount > 0;

export function BookCard({ book, i = 0 }: { book: Book; i?: number }) {
  const p = book.progress;
  return (
    <Link href={`/books/${book.id}`} data-testid={`card-book-${book.id}`} className="group block rise" style={{ animationDelay: `${i * 60}ms` }}>
      <div className="lift"><Cover src={book.coverImage} title={book.title} /></div>
      <h3 className="serif mt-4 text-xl leading-tight">{book.title}</h3>
      <p className="text-sm text-muted-foreground">{book.author}</p>
      <p className="mt-1 text-xs text-muted-foreground" data-testid={`text-status-${book.id}`}>
        {playable(book) ? `${book.sample ? 'Sample edition' : 'Visual edition'} · ${human(book.duration)} · ${book.chapterCount} chapters` : label(book.status)}
      </p>
      {p && p.percentage > 0 && (
        <div className="mt-3 h-px w-full bg-border"><div className="h-px bg-primary transition-all" style={{ width: `${Math.min(100, p.percentage)}%` }} /></div>
      )}
    </Link>
  );
}
