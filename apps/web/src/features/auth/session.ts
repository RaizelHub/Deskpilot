import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { Session } from "@/lib/types";
export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await api<Session>("/auth/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}
