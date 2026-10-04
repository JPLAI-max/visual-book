import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useGetAdminData, useGetAdminOverview, getGetAdminDataQueryKey, type AdminRow } from '@workspace/api-client-react';
import { Shell } from '@/components/Shell';
import { Block, ErrorState, Message } from '@/components/States';
import { RowDetail } from '@/components/admin/RowDetail';
import { BookForm } from '@/components/admin/BookForm';
import { SettingsPanel } from '@/components/admin/SettingsPanel';
import { useReader } from '@/lib/use-reader';
import { label } from '@/lib/format';

const SECTIONS = ['catalog', 'requests', 'jobs', 'books', 'editions', 'chapters', 'scenes', 'characters', 'environments', 'feedback', 'analytics', 'rights', 'costs', 'providers', 'settings'];

function Stat({ k, v }: { k: string; v: string | number }) {
  return <div className="border-t pt-4"><p className="eyebrow">{k}</p><p className="serif mt-2 text-4xl" data-testid={`stat-${k}`}>{v}</p></div>;
}
function Mini({ title, rows }: { title: string; rows: AdminRow[] }) {
  return (
    <div><h3 className="serif mb-3 text-2xl">{title}</h3>
      {rows.length ? <ul className="divide-y border-y">{rows.map((r) => <li key={r.id} className="flex justify-between py-3 text-sm"><span>{r.title}</span><span className="text-muted-foreground">{r.subtitle ?? label(r.status)}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">Nothing yet.</p>}
    </div>
  );
}

function Overview() {
  const { data: o, isLoading, isError, refetch } = useGetAdminOverview();
  if (isLoading) return <Block lines={5} />;
  if (isError || !o) return <ErrorState onRetry={() => refetch()} what="the overview" />;
  return (
    <div className="space-y-16">
      <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
        <Stat k="Books" v={o.totalBooks} /><Stat k="Published" v={o.publishedEditions} /><Stat k="Generating" v={o.generating} /><Stat k="Requested" v={o.requested} />
        <Stat k="Viewers" v={o.viewers} /><Stat k="Watch hours" v={o.watchHours.toFixed(1)} /><Stat k="Completion" v={`${o.completionRate.toFixed(1)}%`} /><Stat k="Spend" v={`$${o.generationSpend.toFixed(2)}`} />
      </div>
      <div className="grid gap-12 md:grid-cols-3"><Mini title="Most watched" rows={o.mostWatched} /><Mini title="Most requested" rows={o.mostRequested} /><Mini title="Revisions" rows={o.revisions} /></div>
    </div>
  );
}

function Section({ name }: { name: string }) {
  const { data, isLoading, isError, refetch } = useGetAdminData(name, { query: { queryKey: getGetAdminDataQueryKey(name), refetchInterval: name === 'jobs' ? 5000 : 30000 } });
  const [sel, setSel] = useState<AdminRow | null>(null);
  const [nb, setNb] = useState(false);
  if (isLoading) return <Block lines={6} />;
  if (isError) return <ErrorState onRetry={() => refetch()} what={name} />;
  if (name === 'settings') return <SettingsPanel row={data?.[0]} />;
  const rows = data ?? [];
  return (
    <div>
      {name === 'providers' && <p className="mb-6 max-w-xl border-l-2 border-primary/60 pl-4 text-sm text-muted-foreground" data-testid="text-provider-honesty">Media generation providers are not configured. Planning is structured text analysis only; no images, video or voice are generated until a provider is connected.</p>}
      {(name === 'books' || name === 'catalog') && <button className="btn mb-6" onClick={() => setNb(true)} data-testid="button-new-book">New book</button>}
      {rows.length === 0 ? <Message title={`No ${name} yet`} body="Records will appear here as the catalog grows." /> : (
        <ul className="divide-y border-y">
          {rows.map((r) => (
            <li key={r.id}>
              <button className="flex w-full items-center justify-between gap-4 py-4 text-left transition-colors hover:bg-muted/50" onClick={() => setSel(r)} data-testid={`row-${name}-${r.id}`}>
                <span><span className="serif text-xl">{r.title}</span>{r.subtitle && <span className="ml-3 text-sm text-muted-foreground">{r.subtitle}</span>}</span>
                <span className="rounded-full bg-muted px-3 py-1 text-xs">{label(r.status)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <RowDetail row={sel} section={name} onClose={() => setSel(null)} />
      <BookForm open={nb} onClose={() => setNb(false)} />
    </div>
  );
}

export default function Admin() {
  const { admin, loading } = useReader();
  const section = useParams().section;
  if (loading) return <Shell><div className="mt-16 max-w-md"><Block /></div></Shell>;
  if (!admin) return <Shell><Message title="Access denied" body="This area is for editors only." action={<Link href="/" className="btn" data-testid="link-denied-home">Return home</Link>} /></Shell>;
  const valid = !section || SECTIONS.includes(section);
  return (
    <Shell>
      <div className="grid gap-12 pt-6 md:grid-cols-[180px_1fr]">
        <nav className="flex flex-wrap gap-x-5 gap-y-2 md:block md:space-y-1.5" aria-label="Admin">
          <Link href="/admin" className={`block text-sm ${!section ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`} data-testid="link-admin-overview">Overview</Link>
          {SECTIONS.map((s) => <Link key={s} href={`/admin/${s}`} className={`block text-sm capitalize ${section === s ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`} data-testid={`link-admin-${s}`}>{s}</Link>)}
        </nav>
        <div className="min-w-0">
          <h1 className="serif mb-10 text-5xl capitalize">{section ?? 'Overview'}</h1>
          {!valid ? <Message title="Unknown section" /> : section ? <Section key={section} name={section} /> : <Overview />}
        </div>
      </div>
    </Shell>
  );
}
