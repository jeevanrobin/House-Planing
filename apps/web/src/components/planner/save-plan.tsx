"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createProject, listProjects, savePlan, type ProjectSummary } from "@/lib/data/projects";
import { hasSupabase } from "@/lib/supabase/config";
import { useUser } from "@/lib/supabase/use-user";
import type { PlanResult, Requirements } from "@/lib/floorplan/types";

export const PENDING_KEY = "pendingPlanRequirements";
const NEW = "__new__";

/** Save the current plan into one of the user's projects (or a new one). */
export function SavePlan({ req, plan, vastu, projectId }: { req: Requirements; plan: PlanResult; vastu: number; projectId?: string }) {
  const user = useUser();
  const [projects, setProjects] = React.useState<ProjectSummary[] | null>(null);
  const [target, setTarget] = React.useState<string>(projectId ?? "");
  const [newName, setNewName] = React.useState("");
  const [name, setName] = React.useState(`${req.bedrooms} BHK · ${req.floors} floor${req.floors > 1 ? "s" : ""}`);
  const [state, setState] = React.useState<{ s: "idle" | "saving" | "error"; msg?: string } | { s: "saved"; project: string }>({ s: "idle" });

  React.useEffect(() => {
    if (!user) return;
    listProjects().then((ps) => {
      setProjects(ps);
      setTarget((t) => t || (ps[0]?.id ?? NEW));
    }).catch((e: Error) => setState({ s: "error", msg: e.message }));
  }, [user]);

  if (!hasSupabase) return null;

  if (user === null) {
    // Remember the brief so the plan can be rebuilt after signing in.
    const remember = () => window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(req));
    return (
      <div className="space-y-2 rounded-lg border bg-card p-4">
        <p className="text-sm font-semibold">Keep this plan</p>
        <p className="text-sm text-muted-foreground">Sign in to save it to a project and come back to it later.</p>
        <Button asChild className="w-full" onClick={remember}>
          <Link href="/login?next=/planner" onClick={remember}><Save /> Sign in to save</Link>
        </Button>
      </div>
    );
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ s: "saving" });
    try {
      const pid = target === NEW || !target ? await createProject(newName || "My home") : target;
      await savePlan(pid, name || "Plan", req, plan, vastu);
      setState({ s: "saved", project: pid });
    } catch (err) {
      setState({ s: "error", msg: (err as Error).message });
    }
  };

  if (state.s === "saved") {
    return (
      <div className="space-y-2 rounded-lg border bg-card p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold"><Check className="size-4 text-primary" /> Saved</p>
        <Button asChild variant="outline" className="w-full"><Link href={`/dashboard/projects/${state.project}`}>Open project</Link></Button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border bg-card p-4">
      <p className="text-sm font-semibold">Save to project</p>
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Project</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!projects}
          className="w-full rounded-md border bg-background px-2 py-2 text-sm">
          {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value={NEW}>New project…</option>
        </select>
      </label>
      {(target === NEW || (projects && !projects.length)) && (
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">New project name</span>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={120} placeholder="My home"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
        </label>
      )}
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Plan name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
      </label>
      {state.s === "error" && <p role="alert" className="text-sm text-destructive">{state.msg}</p>}
      <Button type="submit" className="w-full" disabled={state.s === "saving" || !projects}>
        {state.s === "saving" ? <Loader2 className="animate-spin" /> : <Save />} Save plan
      </Button>
    </form>
  );
}
