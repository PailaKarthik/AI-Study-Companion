"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { fetchHome } from "./api";

/** Home dashboard data. Nulls/empties mean "no data yet" — never faked. */
export function useHome() {
  return useQuery({
    queryKey: queryKeys.home,
    queryFn: ({ signal }) => fetchHome(signal),
    retry: false,
  });
}
