"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { FloorPlanCanvas } from "@/components/planner/floor-plan-canvas";
import { generatePlan } from "@/lib/floorplan/engine";
import type { Requirements } from "@/lib/floorplan/types";
import { planSubtitle, planTitle } from "@/lib/floorplan/units";

/** The plan in the hero is generated live by the same engine users get. */
const SAMPLE: Requirements = {
  plotWidth: 30 * 0.3048, plotDepth: 50 * 0.3048, facing: "E", floors: 2, bedrooms: 3, bathrooms: 3, parking: 1,
  balconies: 1, vastu: true, garden: false, pool: false, homeOffice: false,
  budget: "standard", style: "modern", luxury: 3,
};

const STEPS = [
  { title: "Draw your plot", body: "Trace the boundary on satellite imagery. Area, frontage, depth and facing are measured as you draw — any shape, not just rectangles." },
  { title: "Describe your home", body: "Floors, bedrooms and baths, parking, balconies, Vastu, garden or pool, and how much of the plot to build on." },
  { title: "Get a buildable plan", body: "A furnished, dimensioned plan that follows your land, with a site plan, a 3D model and a Vastu score — in under a second." },
];

const INCLUDED = [
  ["Follows your plot's shape", "Squares up with the road frontage and steps with an irregular boundary."],
  ["Real house structure", "Sit-out, living, kitchen and dining, hallway and bedrooms with attached baths — every room reachable."],
  ["Vastu against true north", "Room directions are scored with the compass, even when the plot is skewed."],
  ["Architect's drawing sheet", "230 mm walls, door swings, windows, furniture, dimension chains and a title block."],
  ["Site plan", "Setbacks, parking or a car porch, garden and pool placed on the open land."],
  ["3D model", "Orbit the house floor by floor, with the roof on or off."],
  ["Editable", "Drag, resize and retype rooms; walls, doors and windows follow."],
  ["Saved to your account", "Projects, plots and plans kept privately in your account."],
] as const;

const FAQ = [
  { q: "Is this a replacement for an architect?", a: "No. It gives you a strong, realistic starting point in seconds — a plan to discuss, compare and refine. Construction drawings, structure and approvals still need a licensed professional." },
  { q: "My plot isn't a rectangle. Will it work?", a: "Yes. Draw the real boundary on the map; the house is oriented to the road and its outline steps with the land. Choose “Maximise the plot” for a larger home that follows the shape, or “Balanced” for a compact house with garden around it." },
  { q: "How is Vastu handled?", a: "Each room has a preferred direction (kitchen south-east, master bedroom south-west, pooja north-east…). The engine tries mirrored and reordered layouts and keeps the best score, measured against true north. It's guidance, not a ruling." },
  { q: "Do I need an account?", a: "No — you can generate and explore plans right away. Sign in to save projects and plans and come back to them." },
  { q: "What does it cost?", a: "Everything on this page is free while we're in early access. A Pro plan with PDF and CAD export and photoreal renders is in the works." },
];

export default function Landing() {
  const reduce = useReducedMotion();
  const sample = React.useMemo(() => generatePlan(SAMPLE), []);
  const rise = (delay = 0) => reduce ? {} : {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] as const },
  };

  return (
    <div className="min-h-dvh">
      <SiteHeader />

      {/* Hero: the product's own output is the headline image. */}
      <section className="relative border-b bg-grid">
        <div className="container grid items-center gap-10 py-14 lg:grid-cols-[1fr_1.15fr] lg:py-20">
          <div>
            <motion.p {...rise()} className="label-mono">House plans from the land up</motion.p>
            <motion.h1 {...rise(0.05)}
              className="mt-4 font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-tight sm:text-6xl"
              style={{ fontVariationSettings: '"wdth" 118' }}>
              Draw your plot.<br />
              Get a house that <span className="text-primary">fits it.</span>
            </motion.h1>
            <motion.p {...rise(0.1)} className="mt-5 max-w-xl text-lg text-muted-foreground">
              Trace your land on the map and describe the home you want. In under a second you get a furnished,
              dimensioned, Vastu-scored plan that follows your plot&apos;s real shape — with a site plan and a 3D model.
            </motion.p>
            <motion.div {...rise(0.15)} className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg"><Link href="/planner">Plan my house <ArrowRight /></Link></Button>
              <Button asChild size="lg" variant="outline"><Link href="#how">How it works</Link></Button>
            </motion.div>
            <motion.dl {...rise(0.2)} className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t pt-6">
              {[
                ["< 1 s", "to generate"],
                ["Any", "plot shape"],
                ["Free", "in early access"],
              ].map(([v, l]) => (
                <div key={l}>
                  <dt className="sr-only">{l}</dt>
                  <dd className="font-mono text-2xl font-semibold tabular-nums">{v}</dd>
                  <dd className="text-xs text-muted-foreground">{l}</dd>
                </div>
              ))}
            </motion.dl>
          </div>

          <motion.figure {...rise(0.12)} className="sheet-marks">
            <FloorPlanCanvas
              floor={sample.floors[0]}
              site={sample.site}
              view="plan"
              meta={{ project: planTitle(SAMPLE), subtitle: planSubtitle(SAMPLE, sample.plotArea), date: "Sample" }}
            />
            <figcaption className="mt-3 text-xs text-muted-foreground">
              Generated live by the planning engine — the same output you get. 30 × 50 ft East-facing plot, 3 BHK, G+1, ground floor shown.
            </figcaption>
          </motion.figure>
        </div>
      </section>

      {/* How it works — a real sequence, so it's numbered. */}
      <section id="how" className="container py-20">
        <p className="label-mono">How it works</p>
        <h2 className="mt-2 max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl">From a boundary on the map to a plan you can discuss with a builder.</h2>
        <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="bg-card p-6">
              <span className="font-mono text-sm text-primary">0{i + 1}</span>
              <h3 className="mt-3 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* What every plan includes */}
      <section id="features" className="border-y bg-card/60">
        <div className="container py-20">
          <p className="label-mono">On every plan</p>
          <h2 className="mt-2 max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl">Drawn the way an architect would draw it.</h2>
          <dl className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {INCLUDED.map(([t, d]) => (
              <div key={t} className="border-t pt-4">
                <dt className="font-semibold">{t}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Pricing — honest about what exists today. */}
      <section id="pricing" className="container py-20">
        <p className="label-mono">Pricing</p>
        <h2 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">Free while we&apos;re in early access.</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="sheet-marks rounded-lg border bg-card p-7 shadow-sheet">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-xl font-bold">Free</h3>
              <span className="font-mono text-3xl font-semibold">₹0</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Everything available today.</p>
            <ul className="mt-6 space-y-2.5 text-sm">
              {["Unlimited plans and projects", "Plot drawing on the map", "Floor plan, site plan and 3D model", "Plan editor", "SVG and PNG export", "Saved to your account"].map((f) => (
                <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" /> {f}</li>
              ))}
            </ul>
            <Button asChild className="mt-7 w-full"><Link href="/planner">Start planning</Link></Button>
          </div>
          <div className="rounded-lg border border-dashed p-7">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-xl font-bold">Pro</h3>
              <span className="label-mono">Coming soon</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">For homeowners going to construction, and for professionals.</p>
            <ul className="mt-6 space-y-2.5 text-sm text-muted-foreground">
              {["PDF drawing sets", "DXF export for CAD", "Photoreal exterior and interior renders", "Plan versions and comparisons"].map((f) => (
                <li key={f} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" /> {f}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t bg-card/60">
        <div className="container grid gap-10 py-20 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <p className="label-mono">Questions</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">Before you start</h2>
          </div>
          <div className="divide-y rounded-lg border bg-card">
            {FAQ.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {f.q}
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="border-t">
        <div className="container flex flex-col items-start justify-between gap-6 py-16 sm:flex-row sm:items-center">
          <h2 className="max-w-xl font-display text-2xl font-bold tracking-tight sm:text-3xl">Have a plot? See what fits on it.</h2>
          <Button asChild size="lg"><Link href="/planner">Plan my house <ArrowRight /></Link></Button>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
