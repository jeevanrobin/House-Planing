/**
 * Pro unlock (₹499, one-time, per project) through Razorpay Checkout.
 *
 * The API creates the order and verifies the payment signature; this file
 * only runs Checkout in the browser. Unlocks are read back from Supabase
 * (row-level security: the user's own).
 */
import { supabase } from "@/lib/supabase/client";
import { hasSupabase } from "@/lib/supabase/config";
import { unlockedProjects } from "@/lib/data/projects";

const RAW = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
/** Accepts the API origin with or without the /api/v1 prefix. */
const API = RAW && !RAW.endsWith("/api/v1") ? `${RAW}/api/v1` : RAW;
export const PRO_PRICE = "₹499";
export const PRO_FEATURES = [
  "PDF drawing set — every sheet, ready to print",
  "Colour presentation plan",
  "Front elevation",
  "Plumbing & drainage sheet",
  "Doesn't count towards the 3 free projects",
];

export interface BillingConfig {
  enabled: boolean;
  keyId: string | null;
}

export async function billingConfig(): Promise<BillingConfig> {
  if (!API) return { enabled: false, keyId: null };
  try {
    const res = await fetch(`${API}/billing/config`);
    if (!res.ok) return { enabled: false, keyId: null };
    const body = await res.json();
    return { enabled: !!body.enabled, keyId: body.key_id ?? null };
  } catch {
    return { enabled: false, keyId: null };
  }
}

export async function isUnlocked(projectId: string | undefined): Promise<boolean> {
  if (!projectId || !hasSupabase) return false;
  try {
    return (await unlockedProjects()).has(projectId);
  } catch {
    return false;
  }
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to unlock Pro.");
  const res = await fetch(`${API}/billing/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.detail || `Payment request failed (${res.status})`);
  return json as T;
}

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open(): void; on(event: string, cb: (e: unknown) => void): void };
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load the payment window. Check your connection."));
    document.body.appendChild(s);
  });
}

/**
 * Pay for a project's Pro unlock. Resolves true once the server has verified
 * the payment, false if the buyer closed the window.
 */
export async function unlockProject(projectId: string, email?: string): Promise<boolean> {
  const order = await call<{ order_id: string; amount: number; currency: string; key_id: string }>("orders", { project_id: projectId });
  await loadCheckout();
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name: "AI Plot Planner",
      description: "Pro — drawing set for this project",
      prefill: email ? { email } : undefined,
      theme: { color: "#2A4BD7" },
      handler: (resp: RazorpayResponse) => {
        call<{ unlocked: boolean }>("verify", { project_id: projectId, ...resp })
          .then((r) => resolve(r.unlocked))
          .catch(reject);
      },
      modal: { ondismiss: () => resolve(false) },
    });
    rzp.on("payment.failed", () => reject(new Error("The payment didn't go through. You haven't been charged.")));
    rzp.open();
  });
}
