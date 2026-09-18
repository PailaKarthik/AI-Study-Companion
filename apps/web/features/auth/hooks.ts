"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { fetchCurrentUser, loginRequest, logoutRequest, registerRequest } from "./api";

/**
 * Single source of auth truth for the UI. Backed by GET /api/auth/me over
 * the session cookie; `null` = anonymous. The API remains the authority —
 * this hook only reflects server-verified state for rendering.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: ({ signal }) => fetchCurrentUser(signal),
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: loginRequest,
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.currentUser, user);
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: registerRequest,
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.currentUser, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logoutRequest,
    onSuccess: () => {
      // Server session is revoked by POST /logout. Clear the ENTIRE cache,
      // not just identity — spaces/projects/home/growth entries belong to
      // the previous user and must never render for the next one.
      queryClient.clear();
    },
  });
}
