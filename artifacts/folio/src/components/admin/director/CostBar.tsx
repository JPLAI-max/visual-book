import type { Cost, DirectorDoc } from './types';
import { money } from './types';
export function CostBar({ cost, video }: { cost?: Cost; video?: DirectorDoc['video'] }) {
  if (!cost) return null;
  const actual = cost.actualCost == null ? 'unknown (not zero)' : `${money(cost.actualCost)}${cost.actualCostComplete ? '' : ' so far, incomplete'}`;
  const cell = (l: string, v: string) => <div><p className="eyebrow">{l}</p><p className="tabular-nums" data-testid={`text-cost-${l.toLowerCase().replace(/\W+/g, '-')}`}>{v}</p></div>;
  return (
    <div className="space-y-3 border-y py-4 text-sm" data-testid="panel-cost">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
        {cell('Spend cap', money(cost.maxSpend))}{cell('Reserved estimate', money(cost.reservedSpend))}{cell('Actual', actual)}
        {cell('Generated images', String(cost.imageCount ?? 0))}{cell('Video shots', String(cost.videoShotCount ?? 0))}{cell('Video upgrade est.', money(cost.estimatedVideoUpgradeCost))}
      </div>
      <p className="text-xs text-muted-foreground">Generated images counts every baseline and director attempt, excluding local review sheets. {cost.notice ?? 'Figures are reservation estimates, not billed amounts.'}{video && !video.available ? ` Video provider unavailable${video.provider ? ` (${video.provider})` : ''}; reservation ${money(video.reservation)}.` : ''}</p>
    </div>
  );
}
