import { useAdminAction, type AdminActionInput } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useRefresh } from '@/lib/use-reader';
import { errMsg } from '@/lib/format';
export function useAdminRun() {
  const m = useAdminAction();
  const refresh = useRefresh();
  const { toast } = useToast();
  const run = (action: AdminActionInput['action'], id: number, ok: string, settings?: Record<string, unknown>, done?: () => void) =>
    m.mutate({ data: { action, id, settings } }, {
      onSuccess: (r) => { toast({ title: ok, description: r?.message }); refresh(); done?.(); },
      onError: (e) => toast({ title: 'Action failed', description: errMsg(e), variant: 'destructive' }),
    });
  return { run, pending: m.isPending };
}
