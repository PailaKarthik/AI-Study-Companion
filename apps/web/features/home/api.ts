import type { HomeData } from "@ai-study-companion/shared";
import { api } from "@/lib/api/client";

export async function fetchHome(signal?: AbortSignal) {
  const { data } = await api.get<HomeData>("/api/home", { signal });
  return data;
}
