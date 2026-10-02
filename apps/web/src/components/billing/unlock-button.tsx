"use client";

import * as React from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRO_PRICE, billingConfig, unlockProject } from "@/lib/billing";
import { useUser } from "@/lib/supabase/use-user";

/** "Unlock Pro · ₹499" for one project: Razorpay Checkout, verified by the API. */
export function UnlockButton({ projectId, onUnlocked, size = "sm", className }: {
  projectId: string;
  onUnlocked: () => void;
  size?: "sm" | "default";
  className?: string;
}) {
  const user = useUser();
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { billingConfig().then((c) => setEnabled(c.enabled)); }, []);

  if (enabled === false) return null;
  const pay = async () => {
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
    <span className="inline-flex flex-col items-end gap-1">
      <Button size={size} variant="outline" className={className} onClick={pay} disabled={busy || enabled === null}>
        {busy ? <Loader2 className="animate-spin" /> : <Lock />} Unlock Pro · {PRO_PRICE}
      </Button>
      {error && <span role="alert" className="max-w-56 text-right text-xs text-destructive">{error}</span>}
    </span>
  );
}
