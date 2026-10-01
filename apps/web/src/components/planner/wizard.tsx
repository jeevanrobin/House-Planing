"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import type { Facing, Requirements } from "@/lib/floorplan/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FACINGS: Facing[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const STEPS = ["Plot & Floors", "Rooms", "Lifestyle", "Style & Budget"];

const DEFAULTS: Requirements = {
  plotWidth: 12,
  plotDepth: 18,
  facing: "N",
  floors: 2,
  bedrooms: 3,
  bathrooms: 3,
  parking: 1,
  balconies: 2,
  vastu: true,
  garden: false,
  pool: false,
  homeOffice: false,
  budget: "standard",
  style: "modern",
  luxury: 3,
};

function Stepper({
  label, value, min, max, onChange, suffix,
}: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border bg-card/50 p-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <Button size="icon" variant="outline" className="size-8 rounded-lg"
          onClick={() => onChange(Math.max(min, value - 1))}>–</Button>
        <span className="w-12 text-center font-display text-lg font-semibold tabular-nums">
          {value}{suffix}
        </span>
        <Button size="icon" variant="outline" className="size-8 rounded-lg"
          onClick={() => onChange(Math.min(max, value + 1))}>+</Button>
      </div>
    </div>
  );
}

function Segmented<T extends string | number>({
  options, value, onChange,
}: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-xl border px-3 py-2.5 text-sm font-medium capitalize transition-all",
            value === o.value
              ? "border-primary bg-primary/10 text-primary shadow-glow"
              : "border-border hover:bg-secondary/60",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label, desc, checked, onChange,
}: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center justify-between rounded-xl border p-3 text-left transition-all",
        checked ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/40",
      )}
    >
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <div className={cn("flex size-6 items-center justify-center rounded-full border transition-colors",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
        {checked && <Check className="size-4" />}
      </div>
    </button>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1.5">
    <span className="text-sm font-medium text-muted-foreground">{label}</span>
    {children}
  </label>
);

export function RequirementWizard({
  onComplete,
  initial,
}: {
  onComplete: (req: Requirements) => void;
  initial?: Partial<Requirements>;
}) {
  const [step, setStep] = React.useState(0);
  const [req, setReq] = React.useState<Requirements>({ ...DEFAULTS, ...initial });
  const set = <K extends keyof Requirements>(k: K, v: Requirements[K]) =>
    setReq((r) => ({ ...r, [k]: v }));

  const next = () => (step < 3 ? setStep((s) => s + 1) : onComplete(req));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div className="flex items-center gap-2">
              <div className={cn("flex size-8 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                i < step ? "bg-primary text-primary-foreground"
                  : i === step ? "bg-primary/15 text-primary ring-2 ring-primary"
                  : "bg-muted text-muted-foreground")}>
                {i < step ? <Check className="size-4" /> : i + 1}
              </div>
              <span className={cn("hidden text-sm font-medium sm:block", i === step ? "text-foreground" : "text-muted-foreground")}>{s}</span>
            </div>
            {i < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
          </React.Fragment>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.25 }}
          className="space-y-4"
        >
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Plot width (m)">
                  <input type="number" value={req.plotWidth} min={3} max={100}
                    onChange={(e) => set("plotWidth", Number(e.target.value))}
                    className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm" />
                </Field>
                <Field label="Plot depth (m)">
                  <input type="number" value={req.plotDepth} min={3} max={100}
                    onChange={(e) => set("plotDepth", Number(e.target.value))}
                    className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm" />
                </Field>
              </div>
              <div className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                Plot area ≈ <b className="text-foreground">{(req.plotWidth * req.plotDepth).toFixed(0)} m²</b>
                {" "}({(req.plotWidth * req.plotDepth * 10.7639).toFixed(0)} ft²)
              </div>
              <Field label="Facing direction">
                <Segmented value={req.facing} onChange={(v) => set("facing", v)}
                  options={FACINGS.map((f) => ({ label: f, value: f }))} />
              </Field>
              <Stepper label="Number of floors" value={req.floors} min={1} max={4} onChange={(v) => set("floors", v)} />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <Stepper label="Bedrooms" value={req.bedrooms} min={1} max={8} onChange={(v) => set("bedrooms", v)} />
              <Stepper label="Bathrooms" value={req.bathrooms} min={1} max={8} onChange={(v) => set("bathrooms", v)} />
              <Stepper label="Parking (cars)" value={req.parking} min={0} max={3} onChange={(v) => set("parking", v as Requirements["parking"])} />
              <Stepper label="Balconies" value={req.balconies} min={0} max={6} onChange={(v) => set("balconies", v)} />
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle label="Vastu compliant" desc="Optimise room directions" checked={req.vastu} onChange={(v) => set("vastu", v)} />
              <Toggle label="Garden / lawn" desc="Reserve outdoor green space" checked={req.garden} onChange={(v) => set("garden", v)} />
              <Toggle label="Swimming pool" desc="Add a pool to the plan" checked={req.pool} onChange={(v) => set("pool", v)} />
              <Toggle label="Home office" desc="Dedicated work room" checked={req.homeOffice} onChange={(v) => set("homeOffice", v)} />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <Field label="Budget tier">
                <Segmented value={req.budget} onChange={(v) => set("budget", v)}
                  options={[
                    { label: "Economy", value: "economy" },
                    { label: "Standard", value: "standard" },
                    { label: "Premium", value: "premium" },
                    { label: "Luxury", value: "luxury" },
                  ]} />
              </Field>
              <Field label="Construction style">
                <Segmented value={req.style} onChange={(v) => set("style", v)}
                  options={[
                    { label: "Modern", value: "modern" },
                    { label: "Contemporary", value: "contemporary" },
                    { label: "Traditional", value: "traditional" },
                    { label: "Minimal", value: "minimal" },
                  ]} />
              </Field>
              <Field label={`Luxury level — ${req.luxury}/5`}>
                <input type="range" min={1} max={5} value={req.luxury}
                  onChange={(e) => set("luxury", Number(e.target.value) as Requirements["luxury"])}
                  className="w-full accent-[hsl(var(--primary))]" />
              </Field>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={back} disabled={step === 0}>
          <ArrowLeft /> Back
        </Button>
        <Button onClick={next}>
          {step === 3 ? (<><Sparkles /> Generate Plan</>) : (<>Next <ArrowRight /></>)}
        </Button>
      </div>
    </div>
  );
}
