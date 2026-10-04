import { useGetMe, useGetHome, useGetLibrary } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
export function useReader() {
  const q = useGetMe();
  return { me: q.data, authed: !!q.data?.authenticated, admin: !!q.data?.admin, loading: q.isLoading };
}
export function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
export { useGetHome, useGetLibrary };
