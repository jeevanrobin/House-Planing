"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Download, FileImage, FileCode2, Pencil, RotateCcw, Gauge,
  Compass as CompassIcon, Wind, IndianRupee, Sparkles, CheckCircle2, AlertTriangle, Info,
  MapPin, PencilRuler, ArrowLeft,
} from "lucide-react";
import { RequirementWizard } from "@/components/planner/wizard";
import { FloorPlanCanvas } from "@/components/planner/floor-plan-canvas";
import { PlotSelector } from "@/components/plot/plot-selector";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { generatePlan } from "@/lib/floorplan/engine";
import { exportPNG, exportSVG } from "@/lib/export";
import type { PlanResult, Requirements, Suggestion } from "@/lib/floorplan/types";

type Stage = "choose" | "plot" | "requirements" | "result";

const SUG_ICON = { ventilation: Wind, vastu: CompassIcon, space: Gauge, cost: IndianRupee, circulation: RotateCcw } as const;
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
  const [reqInit, setReqInit] = React.useState<Partial<Requirements> | undefined>();
  const [showUnsafePlan, setShowUnsafePlan] = React.useState(false);
  const canvasWrap = React.useRef<HTMLDivElement>(null);

  // Coming from the dashboard Plot module: skip straight to requirements.
  React.useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("plotHandoff");
      if (raw) {
        setReqInit(JSON.parse(raw) as Partial<Requirements>);
        setStage("requirements");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const onComplete = (r: Requirements) => {
    setReq(r);
    setPlan(generatePlan(r));
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
        {stage === "choose" ? (
          <div className="mx-auto max-w-3xl">
            <div className="mb-8 text-center">
              <Badge className="mb-3"><Sparkles className="size-3" /> AI Planning Engine</Badge>
              <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                How would you like to start?
              </h1>
              <p className="mt-2 text-muted-foreground">
                Pick your plot on the map and we&apos;ll read its size and orientation, or enter dimensions yourself.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <button onClick={() => setStage("plot")} className="group text-left">
                <Card glass className="h-full transition-shadow hover:shadow-glass-lg">
                  <CardContent className="pt-6">
                    <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <MapPin className="size-6" />
                    </span>
                    <h3 className="font-display text-lg font-semibold">Select on map</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Draw your plot boundary on Google Maps. Area, dimensions and facing are detected automatically.
                    </p>
                    <Badge variant="accent" className="mt-3">Recommended</Badge>
                  </CardContent>
                </Card>
              </button>
              <button onClick={() => { setReqInit(undefined); setStage("requirements"); }} className="group text-left">
                <Card className="h-full transition-shadow hover:shadow-glass-lg">
                  <CardContent className="pt-6">
                    <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
                      <PencilRuler className="size-6" />
                    </span>
                    <h3 className="font-display text-lg font-semibold">Enter dimensions</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Know your plot size already? Type the width, depth and facing and skip the map.
                    </p>
                  </CardContent>
                </Card>
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

                <div className="rounded-xl bg-destructive/5 border border-destructive/10 p-4 space-y-2 text-sm text-muted-foreground">
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {plan.floors.map((f, i) => (
                    <button key={f.floor} onClick={() => setActive(i)}
                      className={`rounded-xl border px-4 py-2 text-sm font-medium transition-all ${
                        i === active ? "border-primary bg-primary/10 text-primary" : "hover:bg-secondary/60"
                      }`}>
                      {f.name}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={editable ? "default" : "outline"} onClick={() => setEditable((e) => !e)}>
                    <Pencil /> {editable ? "Editing" : "Edit"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { const s = getSVG(); if (s) exportSVG(s, `floor-${active}`); }}>
                    <FileCode2 /> SVG
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { const s = getSVG(); if (s) exportPNG(s, `floor-${active}`); }}>
                    <FileImage /> PNG
                  </Button>
                  <Button size="sm" variant="ghost" onClick={restart}>
                    <RotateCcw /> New
                  </Button>
                </div>
              </div>

              <div ref={canvasWrap}>
                <FloorPlanCanvas
                  key={`${active}-${editable}`}
                  floor={plan.floors[active]}
                  facing={req.facing}
                  editable={editable}
                />
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {[["Public", "#6366f1"], ["Service", "#14b8a6"], ["Private", "#f59e0b"], ["Circulation", "#64748b"], ["Outdoor", "#22c55e"]].map(([l, c]) => (
                  <span key={l} className="flex items-center gap-1.5">
                    <span className="size-3 rounded" style={{ background: c as string, opacity: 0.5 }} /> {l}
                  </span>
                ))}
              </div>
            </div>

            {/* Sidebar */}
            <aside className="space-y-4">
              <Card glass>
                <CardContent className="grid grid-cols-2 gap-4 pt-6">
                  <Metric label="Plot area" value={`${plan.plotArea.toFixed(0)} m²`} />
                  <Metric label="Built-up" value={`${plan.floors.reduce((a, f) => a + f.metrics.builtUpArea, 0).toFixed(0)} m²`} />
                  <Metric label="Carpet area" value={`${plan.floors.reduce((a, f) => a + f.metrics.carpetArea, 0).toFixed(0)} m²`} />
                  <Metric label="Efficiency" value={`${Math.round(plan.floors[active].metrics.efficiency * 100)}%`} />
                </CardContent>
              </Card>

              <Card glass>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Vastu score</span>
                    <span className="font-display text-2xl font-bold text-primary">
                      {plan.floors[active].metrics.vastuScore}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <motion.div className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                      initial={{ width: 0 }} animate={{ width: `${plan.floors[active].metrics.vastuScore}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }} />
                  </div>
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

              <Button asChild variant="outline" className="w-full">
                <Link href="/dashboard"><Download /> Save to dashboard</Link>
              </Button>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
