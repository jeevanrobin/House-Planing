"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";
import { hasSupabase } from "@/lib/supabase/config";
import { safeNext } from "@/lib/supabase/next-path";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup" | "link";

export default function LoginPage() {
  return (
    <React.Suspense>
      <Login />
    </React.Suspense>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = React.useState<Mode>("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(params.get("error"));
  const [sent, setSent] = React.useState<string | null>(null);

  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const sb = supabase();
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
        router.replace(next);
        router.refresh();
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({
          email, password, options: { emailRedirectTo: callback(), data: { full_name: name.trim() || undefined } },
        });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          setSent(`We sent a confirmation link to ${email}. Open it to finish creating your account.`);
        }
      } else {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: callback() } });
        if (error) throw error;
        setSent(`We sent a sign-in link to ${email}. Open it on this device to continue.`);
      }
    });
  };

  const google = () => run(async () => {
    const { error } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback() } });
    if (error) throw error;
  });

  return (
    <div className="min-h-dvh bg-grid">
      <SiteHeader />
      <main className="container flex justify-center py-12 sm:py-20">
        <div className="sheet-marks w-full max-w-md rounded-lg border bg-card p-6 shadow-sheet sm:p-8">
          <p className="label-mono">{mode === "signup" ? "New account" : "Welcome back"}</p>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">
            {mode === "signup" ? "Create your account" : "Sign in to save your plans"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Projects, plots and generated plans are stored securely in your account.
          </p>

          {!hasSupabase ? (
            <p className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              Sign-in isn&apos;t configured on this deployment (missing Supabase settings).
            </p>
          ) : sent ? (
            <div className="mt-6 space-y-4">
              <div className="flex gap-3 rounded-md border bg-accent p-4 text-sm text-accent-foreground">
                <Mail className="mt-0.5 size-4 shrink-0" /> <span>{sent}</span>
              </div>
              <Button variant="ghost" className="-ml-3" onClick={() => setSent(null)}><ArrowLeft /> Use a different email</Button>
            </div>
          ) : (
            <>
              <Button type="button" variant="outline" className="mt-6 w-full" onClick={google} disabled={busy}>
                <GoogleMark /> Continue with Google
              </Button>

              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or with email <span className="h-px flex-1 bg-border" />
              </div>

              <div role="tablist" aria-label="Sign-in method" className="mb-4 grid grid-cols-3 rounded-md border p-0.5 text-sm">
                {([["signin", "Password"], ["link", "Email link"], ["signup", "New account"]] as const).map(([m, label]) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); }}
                    className={cn("rounded px-2 py-1.5 font-medium transition-colors",
                      mode === m ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {label}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-3">
                {mode === "signup" && (
                  <Field label="Your name" htmlFor="name">
                    <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name"
                      className="w-full rounded-md border bg-background px-3 py-2.5 text-sm" />
                  </Field>
                )}
                <Field label="Email" htmlFor="email">
                  <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email" className="w-full rounded-md border bg-background px-3 py-2.5 text-sm" />
                </Field>
                {mode !== "link" && (
                  <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters" : undefined}>
                    <input id="password" type="password" required minLength={mode === "signup" ? 8 : undefined}
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      className="w-full rounded-md border bg-background px-3 py-2.5 text-sm" />
                  </Field>
                )}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="animate-spin" />}
                  {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Email me a sign-in link"}
                </Button>
              </form>
            </>
          )}

          <p className="mt-6 text-xs text-muted-foreground">
            You can try the planner without an account. <Link href="/planner" className="text-primary hover:underline">Open the planner</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex justify-between text-sm font-medium">
        {label} {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7H2.1a11 11 0 0 0 0 9.9z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  );
}
