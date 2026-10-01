import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let storage: Storage;
let fetchMock: ReturnType<typeof vi.fn>;

async function load() {
  vi.resetModules();
  return import("./client");
}

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  storage.setItem("app.accessToken", "old-access");
  storage.setItem("app.refreshToken", "old-refresh");
});

afterEach(() => vi.unstubAllGlobals());

const refreshCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"));

describe("api client token refresh", () => {
  it("refreshes on 401 and retries with the new access token", async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return json(200, { access_token: "new-access", refresh_token: "new-refresh" });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer new-access" ? json(200, { ok: true }) : json(401, { detail: "expired" });
    });
    const { api } = await load();

    await expect(api("/projects")).resolves.toEqual({ ok: true });
    expect(storage.getItem("app.accessToken")).toBe("new-access");
    expect(storage.getItem("app.refreshToken")).toBe("new-refresh");
  });

  it("shares one refresh between concurrent 401s", async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/auth/refresh")) return json(200, { access_token: "new-access", refresh_token: "new-refresh" });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer new-access" ? json(200, { url }) : json(401, {});
    });
    const { api } = await load();

    await Promise.all([api("/a"), api("/b"), api("/c")]);
    expect(refreshCalls()).toHaveLength(1);
  });

  it("signs out when the refresh is rejected", async () => {
    fetchMock.mockImplementation(async () => json(401, { detail: "nope" }));
    const { api, ApiError } = await load();

    await expect(api("/projects")).rejects.toBeInstanceOf(ApiError);
    expect(storage.getItem("app.accessToken")).toBeNull();
    expect(storage.getItem("app.refreshToken")).toBeNull();
    expect(refreshCalls()).toHaveLength(1);
  });

  it("does not try to refresh without a refresh token", async () => {
    storage.removeItem("app.refreshToken");
    fetchMock.mockImplementation(async () => json(401, {}));
    const { api } = await load();

    await expect(api("/projects")).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls()).toHaveLength(0);
  });

  it("retries at most once", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/auth/refresh")
        ? json(200, { access_token: "a2", refresh_token: "r2" })
        : json(401, {}),
    );
    const { api } = await load();

    await expect(api("/projects")).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls()).toHaveLength(1);
  });
});
