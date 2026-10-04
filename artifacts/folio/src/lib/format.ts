export const clock = (s: number) => {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};
export const human = (s: number) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`;
};
export const label = (s?: string) => (s ?? '').replace(/_/g, ' ');
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
