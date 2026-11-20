import { onlineUrl } from "@/lib/net/online-config";

/**
 * One read of an admin route with the key. The key goes out only as `Authorization: Bearer` (a header Cloudflare's
 * logs redact): never in the URL, never with cookies, never as a referrer. The Worker answers a wrong key, a route
 * that is off and a fault alike, with the 404 of any unknown path, and a 429 past its limit.
 */
export type AdminRead<T> = { state: "ok"; body: T } | { state: "refused" } | { state: "busy" } | { state: "failed" };

export async function readAdmin<T>(path: string, key: string): Promise<AdminRead<T>> {
  const url = onlineUrl(path);
  if (!url) return { state: "failed" };
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (res.status === 404) return { state: "refused" };
    if (res.status === 429) return { state: "busy" };
    if (!res.ok) return { state: "failed" };
    return { state: "ok", body: (await res.json()) as T };
  } catch {
    return { state: "failed" };
  }
}
