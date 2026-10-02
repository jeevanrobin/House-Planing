"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import type { BuildingType, Facing, Requirements } from "@/lib/floorplan/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FACINGS: Facing[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const STEPS = ["Plot & Floors", "Rooms", "Lifestyle", "Style & Budget"];

const FT = 0.3048;

const TYPES: { value: BuildingType; title: string; desc: string }[] = [
  { value: "house", title: "Independent house", desc: "One home, on one floor or more." },
  { value: "duplex", title: "Duplex", desc: "One family over two floors — living below, bedrooms above." },
  { value: "rental", title: "Floors for rent", desc: "A separate home on every floor, with a staircase from outside." },
  { value: "cottage", title: "Cottage", desc: "Single storey, rooms round a dining hall, verandahs outside." },
  { value: "manduva", title: "Manduva house", desc: "Single storey, rooms round an open courtyard. Needs ~45×55 ft." },
  { value: "apartment", title: "Apartment", desc: "Stilt parking, flats above round a stair and lift. Needs ~50×60 ft." },
];
const SINGLE_STOREY: BuildingType[] = ["cottage", "manduva"];
/** Common Indian plot sizes in feet (width along the road × depth). */
const PRESETS: [number, number][] = [[20, 30], [20, 40], [25, 50], [30, 40], [30, 50], [40, 60], [50, 80]];

const DEFAULTS: Requirements = {
  plotWidth: 30 * FT,
  plotDepth: 50 * FT,
  facing: "E",
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
    <div className="flex items-center justify-between rounded-md border bg-card/50 p-3">
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
            "rounded-md border px-3 py-2.5 text-sm font-medium capitalize transition-all",
            value === o.value
              ? "border-primary bg-accent text-accent-foreground"
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
        "flex items-center justify-between rounded-md border p-3 text-left transition-all",
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

  const [unit, setUnit] = React.useState<"ft" | "m">("ft");
  const toUnit = (m: number) => Math.round((unit === "ft" ? m / FT : m) * 10) / 10;
  const fromUnit = (v: number) => (unit === "ft" ? v * FT : v);
  const sameFt = (a: number, b: number) => Math.abs(a / FT - b) < 0.05;

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
                  : i === step ? "bg-accent text-accent-foreground ring-2 ring-primary"
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
              <Field label="What are you building?">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {TYPES.map((t) => {
                    const active = (req.buildingType ?? "house") === t.value;
                    return (
                      <button key={t.value} type="button" aria-pressed={active}
                        onClick={() => setReq((r) => ({
                          ...r,
                          buildingType: t.value,
                          // A duplex is two floors; rental homes need at least two.
                          flatsPerFloor: t.value === "apartment" ? r.flatsPerFloor ?? 2 : undefined,
                          floors: t.value === "duplex" ? 2 : t.value === "rental" ? Math.max(2, r.floors)
                            : t.value === "apartment" ? Math.max(4, r.floors)
                            : SINGLE_STOREY.includes(t.value) ? 1 : r.floors,
                        }))}
                        className={cn("rounded-md border p-3 text-left transition-colors",
                          active ? "border-primary bg-accent text-accent-foreground" : "hover:bg-secondary/60")}>
                        <span className="block text-sm font-semibold">{t.title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{t.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>
              {!req.plotPolygon && (
                <Field label="Standard plot sizes (ft)">
                  <div className="flex flex-wrap gap-2">
                    {PRESETS.map(([w, d]) => {
                      const active = sameFt(req.plotWidth, w) && sameFt(req.plotDepth, d);
                      return (
                        <button key={`${w}x${d}`} type="button" aria-pressed={active}
                          onClick={() => setReq((r) => ({ ...r, plotWidth: w * FT, plotDepth: d * FT }))}
                          className={cn("rounded-md border px-3 py-1.5 font-mono text-sm tabular-nums transition-colors",
                            active ? "border-primary bg-accent text-accent-foreground" : "hover:bg-secondary/60")}>
                          {w}×{d}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                <Field label={`Width along the road (${unit})`}>
                  <input type="number" value={toUnit(req.plotWidth)} min={unit === "ft" ? 10 : 3} max={unit === "ft" ? 330 : 100}
                    onChange={(e) => set("plotWidth", fromUnit(Number(e.target.value)))}
                    className="w-full rounded-md border bg-background px-3 py-2.5 text-sm tabular-nums" />
                </Field>
                <Field label={`Depth (${unit})`}>
                  <input type="number" value={toUnit(req.plotDepth)} min={unit === "ft" ? 10 : 3} max={unit === "ft" ? 330 : 100}
                    onChange={(e) => set("plotDepth", fromUnit(Number(e.target.value)))}
                    className="w-full rounded-md border bg-background px-3 py-2.5 text-sm tabular-nums" />
                </Field>
                <div role="group" aria-label="Units" className="flex rounded-md border p-0.5">
                  {(["ft", "m"] as const).map((u) => (
                    <button key={u} type="button" onClick={() => setUnit(u)} aria-pressed={unit === u}
                      className={cn("rounded px-3 py-2 text-sm font-medium", unit === u ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                Plot area ≈ <b className="text-foreground">{Math.round(req.plotWidth * req.plotDepth * 10.7639).toLocaleString("en-IN")} sq ft</b>
                {" "}· {Math.round(req.plotWidth * req.plotDepth * 1.19599).toLocaleString("en-IN")} sq yd
                {" "}· {Math.round(req.plotWidth * req.plotDepth)} m²
              </div>
              <Field label="Facing direction">
                <Segmented value={req.facing} onChange={(v) => set("facing", v)}
                  options={FACINGS.map((f) => ({ label: f, value: f }))} />
              </Field>
              {req.buildingType !== "duplex" && !SINGLE_STOREY.includes(req.buildingType ?? "house") && (
                <Stepper label={req.buildingType === "rental" ? "Floors (one home each)" : req.buildingType === "apartment" ? "Floors (ground = stilt parking)" : "Number of floors"}
                  value={req.floors} min={req.buildingType === "rental" || req.buildingType === "apartment" ? 2 : 1}
                  max={req.buildingType === "apartment" ? 6 : 4} onChange={(v) => set("floors", v)} />
              )}
              {req.plotPolygon && (
                <Field label="How much of the plot should the house use?">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([
                      ["max", "Maximise the plot", "A larger home that follows your plot's shape (about 60% coverage)."],
                      ["balanced", "Balanced", "A compact home with open garden around it."],
                    ] as const).map(([v, title, desc]) => {
                      const active = (req.plotUse ?? "max") === v;
                      return (
                        <button key={v} type="button" onClick={() => set("plotUse", v)} aria-pressed={active}
                          className={cn("rounded-md border p-3 text-left transition-colors",
                            active ? "border-primary bg-accent text-accent-foreground" : "hover:bg-secondary")}>
                          <span className="block text-sm font-semibold">{title}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              {(req.buildingType === "rental" || req.buildingType === "apartment") && (
                <p className="text-sm text-muted-foreground">Rooms for <b className="text-foreground">each</b> {req.buildingType === "apartment" ? "flat" : "home"} — they&apos;re all the same.</p>
              )}
              {req.buildingType === "apartment" && (
                <Stepper label="Flats per floor" value={req.flatsPerFloor ?? 2} min={2} max={4}
                  onChange={(v) => set("flatsPerFloor", v as 2 | 3 | 4)} />
              )}
              <Stepper label={req.buildingType === "rental" ? "Bedrooms per home" : req.buildingType === "apartment" ? "Bedrooms per flat" : "Bedrooms"} value={req.bedrooms} min={1} max={8} onChange={(v) => set("bedrooms", v)} />
              <Stepper label={req.buildingType === "rental" ? "Bathrooms per home" : req.buildingType === "apartment" ? "Bathrooms per flat" : "Bathrooms"} value={req.bathrooms} min={1} max={8} onChange={(v) => set("bathrooms", v)} />
              {/* Apartments size their stilt parking and balconies from the flats. */}
              {req.buildingType !== "apartment" && (
                <>
                  <Stepper label="Parking (cars)" value={req.parking} min={0} max={3} onChange={(v) => set("parking", v as Requirements["parking"])} />
                  <Stepper label="Balconies" value={req.balconies} min={0} max={6} onChange={(v) => set("balconies", v)} />
                </>
              )}
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
