import { useEffect, useState } from 'react';
import { useCreateBook, useUpdateBook, BookInputRightsStatus, type BookInput } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useRefresh } from '@/lib/use-reader';
import { errMsg, label } from '@/lib/format';

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const LICENSE_FIELDS = [
  ['rightsHolder', 'Rights holder'], ['startDate', 'License start (YYYY-MM-DD)'], ['expiration', 'License expiration (YYYY-MM-DD)'],
  ['territory', 'Territory'], ['usagePermissions', 'Usage permissions (include adaptation)'], ['royaltyRate', 'Royalty rate (%)'],
  ['revenueShare', 'Revenue share (%)'], ['contractReference', 'Contract file reference'],
] as const;

export function BookForm({ open, onClose, bookId, initial }: { open: boolean; onClose: () => void; bookId?: number; initial?: Record<string, unknown> }) {
  const [f, setF] = useState({ title: '', author: '', description: '', genre: '', rightsStatus: 'unknown', rightsNotes: '', year: '', coverImage: '', licenseName: '', licenseUrl: '', attribution: '' });
  const [licenseFields, setLicenseFields] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    const lic = (initial?.license ?? {}) as Record<string, unknown>;
    setLicenseFields(Object.fromEntries(LICENSE_FIELDS.map(([key]) => [key, s(lic[key])])));
    setF({ title: s(initial?.title), author: s(initial?.author), description: s(initial?.description), genre: s(initial?.genre), rightsStatus: s(initial?.rightsStatus) || 'unknown', rightsNotes: s(initial?.rightsNotes), year: s(initial?.year), coverImage: s(initial?.coverImage), licenseName: s(lic.name), licenseUrl: s(lic.sourceUrl), attribution: s(lic.attribution) });
  }, [open, initial]);
  const create = useCreateBook(), update = useUpdateBook();
  const refresh = useRefresh();
  const { toast } = useToast();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = () => {
    const license: Record<string, unknown> = { ...((initial?.license ?? {}) as Record<string, unknown>) };
    for (const [key] of LICENSE_FIELDS) {
      const value = licenseFields[key] ?? '';
      license[key] = value && ['royaltyRate', 'revenueShare'].includes(key) ? Number(value) : value;
    }
    if (f.licenseName) license.name = f.licenseName;
    if (f.licenseUrl) license.sourceUrl = f.licenseUrl;
    if (f.attribution) license.attribution = f.attribution;
    const data: BookInput = { title: f.title.trim(), author: f.author.trim(), description: f.description, genre: f.genre || 'Fiction', rightsStatus: f.rightsStatus as BookInput['rightsStatus'], rightsNotes: f.rightsNotes || undefined, year: f.year ? Number(f.year) : undefined, coverImage: f.coverImage || undefined, license: Object.keys(license).length ? license : undefined };
    const cb = { onSuccess: () => { toast({ title: bookId ? 'Book updated' : 'Book created' }); refresh(); onClose(); }, onError: (e: unknown) => toast({ title: 'Could not save', description: errMsg(e), variant: 'destructive' }) };
    if (bookId) update.mutate({ id: bookId, data }, cb); else create.mutate({ data }, cb);
  };
  const pending = create.isPending || update.isPending;
  const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="block"><span className="eyebrow">{t}</span><div className="mt-1">{children}</div></label>;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto rounded-xl bg-background">
        <DialogHeader><DialogTitle className="serif text-2xl font-normal">{bookId ? 'Edit book' : 'New book'}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <L t="Title"><input className="box" value={f.title} onChange={set('title')} data-testid="input-book-title" /></L>
          <L t="Author"><input className="box" value={f.author} onChange={set('author')} data-testid="input-book-author" /></L>
          <L t="Genre"><input className="box" value={f.genre} onChange={set('genre')} data-testid="input-book-genre" /></L>
          <L t="Year"><input className="box" type="number" value={f.year} onChange={set('year')} data-testid="input-book-year" /></L>
          <div className="sm:col-span-2"><L t="Description"><textarea className="box min-h-24" value={f.description} onChange={set('description')} data-testid="input-book-description" /></L></div>
          <L t="Rights status"><select className="box" value={f.rightsStatus} onChange={set('rightsStatus')} data-testid="select-rights-status">{Object.values(BookInputRightsStatus).map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></L>
          <L t="Cover path"><input className="box" value={f.coverImage} onChange={set('coverImage')} placeholder="/covers/..." data-testid="input-book-cover" /></L>
          <div className="sm:col-span-2"><L t="Rights notes"><textarea className="box min-h-16" value={f.rightsNotes} onChange={set('rightsNotes')} data-testid="input-rights-notes" /></L></div>
          <L t="License name"><input className="box" value={f.licenseName} onChange={set('licenseName')} data-testid="input-license-name" /></L>
          <L t="Source URL"><input className="box" value={f.licenseUrl} onChange={set('licenseUrl')} data-testid="input-license-url" /></L>
          <div className="sm:col-span-2"><L t="Attribution"><input className="box" value={f.attribution} onChange={set('attribution')} data-testid="input-license-attribution" /></L></div>
           {LICENSE_FIELDS.map(([key, title]) => <L key={key} t={title}><input className="box" value={licenseFields[key] ?? ''} onChange={e => setLicenseFields({ ...licenseFields, [key]: e.target.value })} data-testid={`input-license-${key}`} /></L>)}
        </div>
        <button className="btn" disabled={pending || !f.title.trim() || !f.author.trim()} onClick={submit} data-testid="button-save-book">{pending ? 'Saving' : 'Save book'}</button>
      </DialogContent>
    </Dialog>
  );
}
