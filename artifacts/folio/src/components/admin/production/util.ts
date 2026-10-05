export type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const isRunning = (j: R) => ['queued', 'running', 'pending'].includes(String(j.status));
export const money = (v: unknown) => (v == null || v === '' || Number.isNaN(Number(v)) ? 'Unknown' : `$${Number(v).toFixed(2)}`);
export const takesOf = (scene: R): R[] => (Array.isArray(scene.versions) ? scene.versions : []);
export const isCur = (t: R, scene: R) => t.current === true || t.is_current === true || (scene.current_version_id != null && t.id === scene.current_version_id);
export const currentTake = (scene: R): R | undefined => takesOf(scene).find((t) => isCur(t, scene));
export const latestTake = (scene: R): R | undefined => { const t = takesOf(scene); return currentTake(scene) ?? t[t.length - 1]; };
export const sceneCost = (prod: R | null, sceneId: number): unknown => {
  const c = prod?.cost_estimates_by_scene;
  if (!c) return null;
  if (Array.isArray(c)) { const f = c.find((x: R) => Number(x.scene_id ?? x.sceneId ?? x.id) === sceneId); return f ? (f.estimate ?? f.cost ?? f.total ?? f.estimated_cost) : null; }
  const v = (c as R)[String(sceneId)];
  return v && typeof v === 'object' ? (v.estimate ?? v.total ?? v.cost) : v;
};
export const takeIds = (v: unknown): number[] => {
  const arr = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as R) : [];
  return arr.map((x) => (x && typeof x === 'object' ? Number((x as R).version_id ?? (x as R).id) : Number(x))).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
};
export const MODES = ['STATIC', 'PAN_ZOOM', 'PARALLAX', 'AI_VIDEO'] as const;
export const parallaxReady = (t?: R) => { const m = t?.metadata as R | undefined; const l = m?.parallax_layers ?? m?.layers; return !!m && Array.isArray(l) && l.length > 1 && m.layers_approved !== false; };
