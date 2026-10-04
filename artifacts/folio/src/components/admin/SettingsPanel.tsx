import { useEffect, useState } from 'react';
import type { AdminRow } from '@workspace/api-client-react';
import { useAdminRun } from './useAdminRun';
import { label } from '@/lib/format';

const flat = (o: unknown): Record<string, string> => {
  const r: Record<string, string> = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (v == null || typeof v !== 'object') r[k] = String(v ?? '');
  return r;
};

export function SettingsPanel({ row }: { row?: AdminRow }) {
  const src = (row?.data?.settings ?? row?.data) as unknown;
  const [vals, setVals] = useState<Record<string, string>>({});
  const { run, pending } = useAdminRun();
  useEffect(() => { setVals(flat(src)); }, [row]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!row) return <p className="text-muted-foreground">No settings record returned.</p>;
  const keys = Object.keys(vals);
  const save = () => {
    const out: Record<string, unknown> = {};
    const source = src as Record<string, unknown>;
    keys.forEach((k) => {
      out[k] = typeof source[k] === 'boolean' ? vals[k] === 'true' : typeof source[k] === 'number' ? Number(vals[k]) : vals[k];
    });
    run('save_settings', 1, 'Settings saved', out);
  };
  return (
    <div className="max-w-xl">
      <p className="mb-6 text-sm text-muted-foreground">Non-secret labels and tier limits only. API keys never live here. No billing is connected.</p>
      <div className="space-y-5">
        {keys.map((k) => (
          <label key={k} className="block"><span className="eyebrow">{label(k.replace(/([A-Z])/g, ' $1'))}</span>
            <input className="box mt-1" value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} data-testid={`input-setting-${k}`} /></label>
        ))}
      </div>
      <button className="btn mt-8" disabled={pending || !keys.length} onClick={save} data-testid="button-save-settings">{pending ? 'Saving' : 'Save settings'}</button>
    </div>
  );
}
