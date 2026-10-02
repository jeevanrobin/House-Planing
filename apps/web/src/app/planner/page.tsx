"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  FileDown, FileImage, FileCode2, Pencil, RotateCcw,
  Sparkles, CheckCircle2, AlertTriangle, Info,
  MapPin, PencilRuler, ArrowLeft,
} from "lucide-react";
import dynamic from "next/dynamic";
import { RequirementWizard } from "@/components/planner/wizard";

// three.js is heavy: load the 3D view only when it's opened, and only in the browser.
const Plan3D = dynamic(() => import("@/components/planner/plan-3d").then((m) => m.Plan3D), {
  ssr: false,
  loading: () => <div className="flex aspect-[16/10] items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">Building the 3D model…</div>,
});
import { FloorPlanCanvas, PlanLegend } from "@/components/planner/floor-plan-canvas";
import { PlotSelector } from "@/components/plot/plot-selector";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { generatePlan, planVastuScore } from "@/lib/floorplan/engine";
import { SavePlan, PENDING_KEY } from "@/components/planner/save-plan";
import { getPlan } from "@/lib/data/projects";
import { readHandoff } from "@/lib/data/handoff";
import { exportPDF, exportPNG, exportSVG } from "@/lib/export";
import type { PlanResult, Requirements, Suggestion } from "@/lib/floorplan/types";
import { planSubtitle, planTitle } from "@/lib/floorplan/units";

type Stage = "choose" | "plot" | "requirements" | "result";

const SEV_STYLE = {
  good: "text-emerald-500", info: "text-sky-500", warn: "text-amber-500",
} as const;
const SEV_ICON = { good: CheckCircle2, info: Info, warn: AlertTriangle } as const;

export default function PlannerPage() {
  const [stage, setStage] = React.useState<Stage>("choose");
  const [req, setReq] = React.useState<Requirements | null>(null);
  const [plan, setPlan] = React.useState<PlanResult | null>(null);
  const [active, setActive] = React.useState(0);
  const [editable, setEditable] = React.useState(false);
  const [view, setView] = React.useState<"plan" | "site" | "3d">("plan");
  const [reqInit, setReqInit] = React.useState<Partial<Requirements> | undefined>();
  const [showUnsafePlan, setShowUnsafePlan] = React.useState(false);
  const [projectId, setProjectId] = React.useState<string | undefined>();
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const canvasWrap = React.useRef<HTMLDivElement>(null);
  const printWrap = React.useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = React.useState(false);

  // PDF drawing set: once the offscreen sheets have rendered, collect and export them.
  React.useEffect(() => {
    if (!printing) return;
    const id = window.setTimeout(async () => {
      const svgs = [...(printWrap.current?.querySelectorAll("svg[viewBox]") ?? [])] as SVGSVGElement[];
      try {
        if (svgs.length) await exportPDF(svgs, `${req?.bedrooms ?? ""}bhk-drawing-set`);
      } finally {
        setPrinting(false);
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [printing, req]);

  React.useEffect(() => {
    // Opening a saved plan (/planner?plan=<id>).
    const planId = new URLSearchParams(window.location.search).get("plan");
    if (planId) {
      getPlan(planId).then((saved) => {
        if (!saved) { setLoadError("That plan doesn't exist or isn't yours."); return; }
        setProjectId(saved.projectId);
        setReq(saved.requirements);
        setPlan(saved.plan);
        setView(saved.requirements.plotPolygon ? "site" : "plan");
        setStage("result");
      }).catch((e: Error) => setLoadError(e.message));
      return;
    }
    // Back from signing in to save: rebuild the plan from the remembered brief.
    try {
      const pending = window.sessionStorage.getItem(PENDING_KEY);
      if (pending) {
        window.sessionStorage.removeItem(PENDING_KEY);
        const handoff = readHandoff();
        if (handoff?.projectId) setProjectId(handoff.projectId);
        onComplete(JSON.parse(pending) as Requirements);
        return;
      }
    } catch {
      /* ignore */
    }
    // Coming from a project's plot: skip straight to requirements.
    const handoff = readHandoff();
    if (handoff) {
      const { projectId: pid, ...init } = handoff;
      setProjectId(pid);
      setReqInit(init);
      setStage("requirements");
    }
  }, []);

  const onComplete = (r: Requirements) => {
    setReq(r);
    setPlan(generatePlan(r));
    // Map-drawn plots open on the site plan, so the house is seen in the land's own shape.
    setView(r.plotPolygon ? "site" : "plan");
    setActive(0);
    setShowUnsafePlan(false);
    setStage("result");
  };

  const restart = () => {
    setPlan(null);
    setReq(null);
    setReqInit(undefined);
    setEditable(false);
    setShowUnsafePlan(false);
    setStage("choose");
  };

  const getSVG = () => canvasWrap.current?.querySelector("svg") ?? null;

  return (
    <div className="min-h-dvh bg-grid">
      <SiteHeader />
      <main className="container py-8">
        {loadError && (
          <p role="alert" className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{loadError}</p>
        )}
        {stage === "choose" ? (
          <div className="mx-auto max-w-4xl">
            <p className="label-mono">New plan</p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">Start with your land.</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Drawing the plot on the map gives the best result — the plan follows its real shape and faces the road.
            </p>
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              <button onClick={() => setStage("plot")}
                className="sheet-marks group rounded-lg border bg-card p-6 text-left shadow-sheet transition-colors hover:border-primary focus-visible:border-primary">
                <svg viewBox="0 0 160 90" className="h-24 w-full text-primary" aria-hidden>
                  <path d="M18 70 L40 16 L104 10 L142 38 L126 78 Z" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 3" />
                  {[[18, 70], [40, 16], [104, 10], [142, 38], [126, 78]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3" fill="currentColor" />)}
                  <rect x="56" y="30" width="44" height="30" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
                <span className="mt-4 flex items-center justify-between">
                  <span className="font-display text-lg font-semibold">Draw it on the map</span>
                  <span className="label-mono text-primary">Recommended</span>
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Trace the boundary on satellite imagery. Area, frontage and facing are measured for you — any shape works.
                </span>
              </button>
              <button onClick={() => { setReqInit(undefined); setStage("requirements"); }}
                className="group rounded-lg border bg-card p-6 text-left shadow-sheet transition-colors hover:border-primary focus-visible:border-primary">
                <svg viewBox="0 0 160 90" className="h-24 w-full text-muted-foreground" aria-hidden>
                  <rect x="30" y="14" width="100" height="62" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M30 8 h100 M30 5 v6 M130 5 v6" stroke="currentColor" strokeWidth="1" />
                  <path d="M138 14 v62 M135 14 h6 M135 76 h6" stroke="currentColor" strokeWidth="1" />
                  <text x="80" y="4" fontSize="7" textAnchor="middle" fill="currentColor">width</text>
                </svg>
                <span className="mt-4 block font-display text-lg font-semibold">Enter the size</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Already know it? Type width, depth and facing for a rectangular plot and skip the map.
                </span>
              </button>
            </div>
          </div>
        ) : stage === "plot" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Button variant="ghost" size="sm" className="mb-1 -ml-2" onClick={() => setStage("choose")}>
                  <ArrowLeft /> Back
                </Button>
                <h1 className="font-display text-2xl font-bold tracking-tight">Select your plot</h1>
                <p className="text-sm text-muted-foreground">Draw the boundary, then continue to your requirements.</p>
              </div>
            </div>
            <PlotSelector
              onContinue={(dims) => { setReqInit(dims); setStage("requirements"); }}
              continueLabel="Continue to requirements"
            />
          </div>
        ) : stage === "requirements" ? (
          <div className="mx-auto max-w-2xl">
            <div className="mb-6 text-center">
              <Button variant="ghost" size="sm" className="mb-2"
                onClick={() => setStage(reqInit?.plotWidth ? "plot" : "choose")}>
                <ArrowLeft /> Back
              </Button>
              <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Tell us about your home</h1>
              <p className="mt-2 text-muted-foreground">
                {reqInit?.plotWidth
                  ? `Plot detected: ${reqInit.plotWidth}×${reqInit.plotDepth} m, ${reqInit.facing} facing. Adjust anything below.`
                  : "Four quick steps. Our engine lays out rooms, circulation and Vastu zones instantly."}
              </p>
            </div>
            <Card glass>
              <CardContent className="pt-6">
                <RequirementWizard onComplete={onComplete} initial={reqInit} />
              </CardContent>
            </Card>
          </div>
        ) : !plan || !req ? null : plan.validation && !plan.validation.ok && !showUnsafePlan ? (
          <div className="mx-auto max-w-xl">
            <Card glass className="border-destructive/30">
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="size-6 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <h2 className="font-display text-xl font-bold text-foreground">Layout Constraint Validation Failed</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The planning engine could not arrange all requested rooms within the buildable footprint of your plot.
                    </p>
                  </div>
                </div>

                <div className="rounded-md bg-destructive/5 border border-destructive/10 p-4 space-y-2 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Unmet requirements:</span>
                  <ul className="list-disc pl-5 space-y-1">
                    {plan.validation.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>

                <p className="text-xs text-muted-foreground">
                  Tip: Try reducing the bedroom/bathroom count, disabling the pool/garden if the plot is tight, or redrawing a larger plot boundary on the map.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Button onClick={() => setStage("requirements")} className="grow sm:grow-0">
                    <PencilRuler /> Adjust requirements
                  </Button>
                  {reqInit?.plotWidth && (
                    <Button variant="outline" onClick={() => setStage("plot")} className="grow sm:grow-0">
                      <MapPin /> Redraw Plot
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setShowUnsafePlan(true)} className="grow sm:grow-0 text-muted-foreground hover:text-foreground">
                    Ignore & view plan
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            {/* Plan area */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-1.5 shadow-sheet">
                <Segmented
                  label="View"
                  value={view}
                  onChange={setView}
                  options={[["plan", "Floor plan"], ["site", "Site plan"], ["3d", "3D"]]}
                />
                {view !== "3d" && plan.floors.length > 1 && (
                  <Segmented
                    label="Floor"
                    value={String(active)}
                    onChange={(v) => setActive(Number(v))}
                    options={plan.floors.map((f, i) => [String(i), f.name.replace(" Floor", "")] as [string, string])}
                  />
                )}
                <div className="ml-auto flex flex-wrap gap-1">
                  {view !== "3d" && (
                    <>
                      <Button size="sm" variant={editable ? "default" : "ghost"} onClick={() => setEditable((e) => !e)} aria-pressed={editable}>
                        <Pencil /> {editable ? "Editing" : "Edit"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { const s = getSVG(); if (s) exportSVG(s, `floor-${active}`); }}>
                        <FileCode2 /> SVG
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { const s = getSVG(); if (s) exportPNG(s, `floor-${active}`); }}>
                        <FileImage /> PNG
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPrinting(true)} disabled={printing}>
                        <FileDown /> {printing ? "Preparing…" : "PDF set"}
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={restart}>
                    <RotateCcw /> New plan
                  </Button>
                </div>
              </div>

              {view === "3d" ? <Plan3D plan={plan} /> : (
              <div ref={canvasWrap}>
                <FloorPlanCanvas
                  key={`${active}-${editable}`}
                  floor={plan.floors[active]}
                  site={plan.site}
                  meta={{
                    project: planTitle(req),
                    subtitle: planSubtitle(req, plan.plotArea),
                    date: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
                  }}
                  view={view}
                  editable={editable}
                />
              </div>
              )}

              {view !== "3d" && <PlanLegend />}

              {/* Offscreen sheets for the PDF drawing set (light palette for printing). */}
              {printing && (
                <div ref={printWrap} aria-hidden className="pointer-events-none fixed -left-[10000px] top-0 w-[1400px]">
                  {[{ f: plan.floors[0], v: "site" as const }, ...plan.floors.map((f) => ({ f, v: "plan" as const }))].map(({ f, v }, i) => (
                    <FloorPlanCanvas key={i} floor={f} site={plan.site} view={v} palette="light"
                      meta={{
                        project: planTitle(req),
                        subtitle: `${planSubtitle(req, plan.plotArea)}${v === "site" ? " · Site plan" : ""}`,
                        date: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
                      }} />
                  ))}
                </div>
              )}
            </div>

            {/* Sidebar */}
            <aside className="space-y-4">
              <Card glass>
                <CardContent className="grid grid-cols-2 gap-4 pt-6">
                  <Metric label="Plot area" value={`${Math.round(plan.plotArea * 10.764).toLocaleString("en-IN")} ft²`} sub={`${plan.plotArea.toFixed(0)} m²`} />
                  <Metric label="House footprint" value={`${(plan.footprint.w * 3.281).toFixed(0)}′ × ${(plan.footprint.h * 3.281).toFixed(0)}′`} sub={`${plan.footprint.w.toFixed(1)} × ${plan.footprint.h.toFixed(1)} m`} />
                  <Metric label="Built-up (all floors)" value={`${Math.round(plan.floors.reduce((a, f) => a + f.metrics.builtUpArea, 0) * 10.764).toLocaleString("en-IN")} ft²`} sub={`${plan.floors.reduce((a, f) => a + f.metrics.builtUpArea, 0).toFixed(0)} m²`} />
                  <Metric label="Carpet (all floors)" value={`${Math.round(plan.floors.reduce((a, f) => a + f.metrics.carpetArea, 0) * 10.764).toLocaleString("en-IN")} ft²`} sub={`${Math.round(plan.floors[active].metrics.efficiency * 100)}% efficiency`} />
                </CardContent>
              </Card>

              <Card glass>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Vastu score</span>
                    <span className="font-display text-2xl font-bold text-primary">
                      {planVastuScore(plan)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <motion.div className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                      initial={{ width: 0 }} animate={{ width: `${planVastuScore(plan)}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {plan.floors[active].name}: {plan.floors[active].metrics.vastuScore}/100
                  </p>
                </CardContent>
              </Card>

              <Card glass>
                <CardContent className="space-y-3 pt-6">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="size-4 text-primary" /> AI Suggestions
                  </h3>
                  {plan.suggestions.map((s: Suggestion, i) => {
                    const Icon = SEV_ICON[s.severity];
                    return (
                      <div key={i} className="flex gap-2.5 text-sm">
                        <Icon className={`mt-0.5 size-4 shrink-0 ${SEV_STYLE[s.severity]}`} />
                        <span className="text-muted-foreground">{s.message}</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <SavePlan req={req} plan={plan} vastu={planVastuScore(plan)} projectId={projectId} />
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

function Segmented<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: [T, string][];
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md bg-muted p-0.5">
      {options.map(([v, text]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${value === v ? "bg-card text-foreground shadow-sheet" : "text-muted-foreground hover:text-foreground"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}
