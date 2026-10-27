import { useQuery } from '@tanstack/react-query';
import { api, keys } from './api';
export function useSession() {
  return useQuery({ queryKey: keys.session, queryFn: () => api('/session'), retry: false });
}
