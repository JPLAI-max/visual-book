import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { getGetQuestionHistoryQueryKey, useAskBookQuestion, useGetQuestionHistory } from '@workspace/api-client-react';
import { clock } from '@/lib/format';
import type { AskReply, HistoryItem } from '@/components/admin/timeline/types';
import { errMsg } from '@/components/admin/timeline/types';

interface Turn { q: string; a?: AskReply; error?: string }
const light = 'text-[hsl(40_33%_94%)]';

export function AskPanel({ bookId, chapterId, sceneId, position, visible, shifted, setPlay, seekTo, onOpenChange }: {
  bookId: number; chapterId: number; sceneId: number; position: number; visible: boolean; shifted: boolean; setPlay: (v: boolean) => void; seekTo: (p: number) => void; onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [frozen, setFrozen] = useState({ sceneId, t: position });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conv, setConv] = useState<string | undefined>();
  const [text, setText] = useState('');
  const [remember, setRemember] = useState(false);
  const [hist, setHist] = useState(false);
  const ask = useAskBookQuestion();
  const playRef = useRef(setPlay); playRef.current = setPlay;
  const input = useRef<HTMLTextAreaElement>(null);
  const seekRef = useRef(seekTo); seekRef.current = seekTo;
  const openCb = useRef(onOpenChange); openCb.current = onOpenChange;
  const panel = useRef<HTMLElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const frozenRef = useRef(frozen); frozenRef.current = frozen;
  const history = useGetQuestionHistory({ bookId }, { query: { enabled: open && hist, queryKey: getGetQuestionHistoryQueryKey({ bookId }) } });
  const items = ((history.data as { data: unknown } | undefined)?.data as { questions?: HistoryItem[] } | undefined)?.questions ?? [];

  const openIt = () => { playRef.current(false); openCb.current(true); setFrozen({ sceneId, t: position }); setOpen(true); };
  const close = () => { openCb.current(false); setOpen(false); };
  const resume = () => { const t = frozenRef.current.t; openCb.current(false); setOpen(false); seekRef.current(t); playRef.current(true); };
  useEffect(() => { if (wasOpen.current && !open) btn.current?.focus(); wasOpen.current = open; }, [open]);
  useEffect(() => () => openCb.current(false), []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const sceneRef = useRef(sceneId); sceneRef.current = sceneId;
  const openRef = useRef(open); openRef.current = open;
  // While open the context stays frozen; a scene change from controls underneath is undone by Resume.
  useEffect(() => { if (open || frozenRef.current.sceneId === sceneId) return; setTurns([]); setConv(undefined); setFrozen({ sceneId, t: position }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sceneId, open]);

  const send = (question: string, retryIdx?: number) => {
    const qn = question.trim(); if (!qn || ask.isPending) return;
    const idx = retryIdx ?? turns.length;
    const requestScene = frozen.sceneId;
    setTurns((t) => (retryIdx === undefined ? [...t, { q: qn }] : t.map((x, i) => (i === idx ? { q: qn } : x))));
    setText('');
    ask.mutate({ data: { bookId, chapterId, sceneId: frozen.sceneId, timestamp: frozen.t, question: qn, conversationId: conv, retainHistory: remember, mode: 'objective' } }, {
      onSuccess: (r) => { if (frozenRef.current.sceneId !== requestScene) return; setConv(r.conversationId); setTurns((t) => t.map((x, i) => (i === idx ? { q: qn, a: r as AskReply } : x))); if (hist) history.refetch(); },
      onError: (e) => { if (frozenRef.current.sceneId !== requestScene) return; if (errMsg(e).includes('expired') || errMsg(e).includes('different scene')) setConv(undefined); setTurns((t) => t.map((x, i) => (i === idx ? { q: qn, error: errMsg(e) } : x))); },
    });
  };
  const submit = (e: FormEvent) => { e.preventDefault(); send(text); };

  return (
    <>
      {(visible || open) && !open && (
        <button ref={btn} onClick={openIt} aria-label="Ask about this scene" data-testid="button-ask"
          className={`absolute top-4 z-10 flex h-9 items-center gap-1.5 rounded-full bg-[hsl(24_25%_8%/.55)] px-3 text-xs ${light} backdrop-blur-sm transition-all hover:bg-[hsl(24_25%_8%/.8)] ${shifted ? 'right-[19rem]' : 'right-4'}`}>
          <HelpCircle className="h-4 w-4" /> Ask
        </button>
      )}
      {open && (
        <section ref={panel} role="dialog" aria-modal="true" aria-label="Ask about this scene" data-testid="panel-ask"
          onKeyDown={(e) => {
            e.stopPropagation(); if (e.key === 'Escape') return close();
            if (e.key !== 'Tab' || !panel.current) return;
            const f = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input,[href]')];
            if (!f.length) return;
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }} onClick={(e) => e.stopPropagation()}
          className={`absolute bottom-24 top-4 z-30 flex w-80 max-w-[calc(100%-2rem)] flex-col max-sm:fixed max-sm:inset-x-2 max-sm:bottom-2 max-sm:top-auto max-sm:h-[min(70dvh,26rem)] max-sm:w-auto max-sm:max-w-none rounded-[6px] bg-[hsl(24_25%_8%/.94)] p-4 ${light} ${shifted ? 'right-[19rem]' : 'right-4'}`}>
          <div className="flex items-start justify-between gap-2">
            <div><p className="eyebrow !text-[hsl(40_33%_94%/.6)]">Paused at {clock(frozen.t)}</p><p className="mt-1 text-xs opacity-70">Ask about what is on screen. Answers stay objective.</p></div>
            <button onClick={close} aria-label="Close" className="rounded-full p-1 hover:bg-white/15" data-testid="button-ask-close"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-3 flex-1 space-y-4 overflow-y-auto pr-1 text-sm" aria-live="polite">
            {hist ? (
              history.isLoading ? <p className="opacity-60">Loading</p> : history.isError ? <p>Could not load your questions. <button className="underline" onClick={() => history.refetch()}>Retry</button></p> :
              items.length === 0 ? <p className="opacity-60">No saved questions for this book. Turn on remembering to keep them.</p> :
              items.map((h, i) => <div key={i}><p className="opacity-60">{h.question}</p><p className="mt-1">{h.answer}</p></div>)
            ) : turns.length === 0 ? <p className="opacity-60">Keep it short. Follow-ups continue the same thread within this scene.</p> :
              turns.map((t, i) => (
                <div key={i}>
                  <p className="opacity-60">{t.q}</p>
                  {t.a && <><p className="mt-1 leading-relaxed">{t.a.answer}</p>{t.a.citations?.length > 0 && <p className="mt-1 text-xs opacity-60">Source: {t.a.citations.join('; ')}</p>}</>}
                  {t.error && <p className="mt-1" role="alert">{t.error} <button className="underline" onClick={() => send(t.q, i)} data-testid="button-ask-retry">Retry</button></p>}
                  {!t.a && !t.error && <p className="mt-1 opacity-60">Thinking</p>}
                </div>
              ))}
          </div>
          {!hist && (
            <form onSubmit={submit} className="mt-3">
              <textarea ref={input} value={text} maxLength={600} rows={2} onChange={(e) => setText(e.target.value)} aria-label="Your question" placeholder="What does this mean?"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
                className="w-full resize-none rounded bg-white/10 p-2 text-sm placeholder:text-[hsl(40_33%_94%/.45)] focus:outline-none focus:ring-1 focus:ring-white/40" data-testid="input-ask" />
              <button type="submit" disabled={!text.trim() || ask.isPending} className="mt-2 h-8 w-full rounded-full bg-[hsl(40_33%_94%)] text-xs font-medium text-[hsl(24_22%_12%)] disabled:opacity-40" data-testid="button-ask-send">Ask</button>
            </form>
          )}
          <div className="mt-3 flex items-center justify-between gap-2 text-xs">
            <label className="flex items-center gap-1.5 opacity-80"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember my questions</label>
            <button className="underline opacity-70 hover:opacity-100" onClick={() => setHist(!hist)} data-testid="button-my-questions">{hist ? 'Back' : 'My questions'}</button>
          </div>
          <button onClick={resume} className="mt-3 h-9 rounded-full bg-white/15 text-xs hover:bg-white/25" data-testid="button-ask-resume">Resume</button>
        </section>
      )}
    </>
  );
}
