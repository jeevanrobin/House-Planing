export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

export const hasApi = API_URL.length > 0;

const ACCESS_KEY = "app.accessToken";
const REFRESH_KEY = "app.refreshToken";

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
}

/** Persist tokens after login/refresh, or clear them (sign-out) with null. */
export function setTokens(tokens: Tokens | null) {
  const s = store();
  if (!s) return;
  if (tokens) {
    s.setItem(ACCESS_KEY, tokens.access_token);
    s.setItem(REFRESH_KEY, tokens.refresh_token);
  } else {
    s.removeItem(ACCESS_KEY);
    s.removeItem(REFRESH_KEY);
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Single-flight: refresh tokens rotate and the server treats a reused one as
// stolen (revoking every session), so concurrent 401s must share one refresh.
let refreshing: Promise<boolean> | null = null;

function refreshTokens(): Promise<boolean> {
  const refreshToken = store()?.getItem(REFRESH_KEY);
  if (!refreshToken) return Promise.resolve(false);
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        setTokens(null);
        return false;
      }
      setTokens((await res.json()) as Tokens);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const t = store()?.getItem(ACCESS_KEY);
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (res.status === 401 && retry && !path.startsWith("/auth/") && (await refreshTokens())) {
    return api<T>(path, init, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail || res.statusText);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
