"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRO_FEATURES, PRO_PRICE, billingConfig, unlockProject } from "@/lib/billing";
import { useUser } from "@/lib/supabase/use-user";

/**
 * Shown in place of a Pro sheet (elevation, services, colour plan, PDF set)
 * until the project is unlocked. Payment needs a signed-in user and a saved
 * project, since the unlock belongs to the project.
 */
export function ProGate({ feature, projectId, onUnlocked }: { feature: string; projectId?: string; onUnlocked: () => void }) {
  const user = useUser();
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => { billingConfig().then((c) => setEnabled(c.enabled)); }, []);

  const pay = async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      if (await unlockProject(projectId, user?.email ?? undefined)) onUnlocked();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-marks rounded-lg border bg-card p-8 shadow-sheet">
      <div className="mx-auto max-w-md text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground"><Lock className="size-5" /></span>
        <p className="label-mono mt-4">Pro</p>
        <h3 className="mt-1 font-display text-2xl font-bold tracking-tight">{feature} is part of Pro</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          One payment of <b className="text-foreground">{PRO_PRICE}</b> unlocks everything below for this project — no subscription.
        </p>
        <ul className="mx-auto mt-5 max-w-xs space-y-2 text-left text-sm">
          {PRO_FEATURES.map((f) => (
            <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" /> {f}</li>
          ))}
        </ul>
        <div className="mt-6">
          {user === null ? (
            <Button asChild className="w-full"><Link href="/login?next=/planner">Sign in to unlock</Link></Button>
          ) : !projectId ? (
            <p className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">Save this plan to a project first (panel on the right) — Pro unlocks a project.</p>
          ) : enabled === false ? (
            <p className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">Payments aren&apos;t set up on this server yet.</p>
          ) : (
            <Button className="w-full" onClick={pay} disabled={busy || enabled === null}>
              {busy ? <Loader2 className="animate-spin" /> : <Lock />} Unlock this project · {PRO_PRICE}
            </Button>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
          <p className="mt-3 text-xs text-muted-foreground">Secure payment by Razorpay · UPI, cards, net banking.</p>
        </div>
      </div>
    </div>
  );
}
