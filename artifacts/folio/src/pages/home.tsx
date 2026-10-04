import { Shell } from '@/components/Shell';
import { Catalog } from '@/components/Catalog';
export default function HomePage() {
  return (
    <Shell>
      <div className="mx-auto max-w-3xl pb-20 pt-16 text-center sm:pt-24">
        <p className="eyebrow rise">Books, seen slowly</p>
        <h1 className="serif rise mt-6 text-5xl leading-[1.05] sm:text-7xl" style={{ animationDelay: '80ms' }}>
          Open a book.<br /><em className="text-muted-foreground">Watch it unfold.</em>
        </h1>
        <p className="rise mx-auto mt-8 max-w-md text-muted-foreground" style={{ animationDelay: '160ms' }}>
          Search for a book you love, open a chapter, and stop whenever you like. Folio remembers the exact second.
        </p>
      </div>
      <Catalog />
    </Shell>
  );
}
