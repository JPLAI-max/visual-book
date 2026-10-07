import { useGetQuestionInsights } from '@workspace/api-client-react';
import { Block, ErrorState, Message } from '@/components/States';
import { clock } from '@/lib/format';
import type { Insight } from './timeline/types';

export function QuestionsPanel() {
  const { data, isLoading, isError, refetch } = useGetQuestionInsights();
  if (isLoading) return <Block lines={5} />;
  if (isError) return <ErrorState onRetry={() => refetch()} what="question insights" />;
  const scenes = ((data as { data: unknown } | undefined)?.data as { scenes?: Insight[] } | undefined)?.scenes ?? [];
  if (!scenes.length) return <Message title="No questions yet" body="When readers ask about a scene, anonymous clarity patterns will show here." />;
  const sorted = [...scenes].sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.question_count - a.question_count);
  return (
    <div>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">Anonymous counts only. Scenes with repeated questions may need a clearer image or line of narration.</p>
      <ul className="divide-y border-y" data-testid="list-insights">
        {sorted.map((s) => (
          <li key={`${s.scene_id}:${s.common_question_topic}:${s.timestamp_cluster}`} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="serif text-xl">{s.title}{s.flagged && <span className="ml-3 rounded-full bg-primary/10 px-3 py-1 align-middle font-sans text-xs text-primary">Needs clarity</span>}</p>
              <p className="mt-1 text-sm text-muted-foreground">Common topic: {s.common_question_topic || 'none yet'} · usually around {clock(s.timestamp_cluster)}</p>
            </div>
            <p className="text-sm tabular-nums text-muted-foreground"><span className="serif text-3xl text-foreground">{s.question_count}</span> questions · {s.unique_viewers} viewers</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
