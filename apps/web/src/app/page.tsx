"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  MapPin, Sparkles, Ruler, Compass, Wind,
  FileDown, ArrowRight, Check, Building2, Home, HardHat,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
};

const FEATURES = [
  { icon: MapPin, title: "Map-based plot selection", desc: "Draw your boundary on satellite imagery and get instant area, perimeter and orientation." },
  { icon: Sparkles, title: "AI planning engine", desc: "Intelligent room allocation, circulation and space optimisation in seconds." },
  { icon: Compass, title: "Vastu intelligence", desc: "Directional scoring and recommendations baked into every generated layout." },
  { icon: Ruler, title: "Dimensioned 2D plans", desc: "Walls, doors, windows, labels, areas, scale bar and compass — print ready." },
  { icon: Wind, title: "Ventilation analysis", desc: "Every plan is checked for daylight and cross-ventilation on habitable rooms." },
  { icon: FileDown, title: "Pro exports", desc: "Export to PNG, SVG and CAD-compatible DXF for your architect or builder." },
];

const AUDIENCE = [
  { icon: Home, title: "Homeowners", desc: "Visualise your dream home before spending on an architect." },
  { icon: HardHat, title: "Builders", desc: "Generate sellable layout options for any plot in minutes." },
  { icon: Building2, title: "Architects & developers", desc: "Rapid concept iterations and client-ready presentations." },
];

const PRICING = [
  { name: "Free", price: "₹0", period: "forever", features: ["3 projects", "Basic 2D plans", "PNG export", "Vastu score"], cta: "Start free", highlight: false },
  { name: "Pro", price: "₹999", period: "/month", features: ["Unlimited projects", "Advanced AI planning", "SVG + DXF export", "Version history", "Priority generation"], cta: "Go Pro", highlight: true },
  { name: "Enterprise", price: "Custom", period: "", features: ["Team collaboration", "Architect toolkit", "API access", "SSO & audit logs", "Dedicated support"], cta: "Contact sales", highlight: false },
];

const FAQ = [
  { q: "Do I need a Google Maps API key?", a: "Only for the live map plot-selection module. The AI planner and 2D generator work fully offline without any key." },
  { q: "How accurate are the Vastu recommendations?", a: "We score each room against classical directional principles and surface concrete suggestions — it's guidance, not a substitute for a consultant." },
  { q: "Can I edit the generated plan?", a: "Yes. The interactive editor lets you drag, resize and retype rooms, with full undo/redo, then re-export." },
  { q: "Is this a replacement for an architect?", a: "It's a powerful concept and iteration tool. Final construction drawings should always be validated by a licensed professional." },
];

const TESTIMONIALS = [
  { name: "Aarav Mehta", role: "Homeowner, Pune", quote: "I had three plan options for my 1,800 sq ft plot before my morning coffee. Incredible." },
  { name: "Studio Verde", role: "Architecture firm", quote: "We use it for first-pass concepts in client meetings. Cuts days off our early design." },
  { name: "Ravi Kumar", role: "Builder, Hyderabad", quote: "Generating layouts per plot used to need a draftsman. Now it's instant and looks premium." },
];

export default function Landing() {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <SiteHeader />

      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 -z-10 spotlight" />
        <div className="absolute inset-0 -z-10 bg-grid [mask-image:radial-gradient(60%_50%_at_50%_0%,black,transparent)]" />
        <div className="container flex flex-col items-center pb-20 pt-16 text-center sm:pt-24">
          <motion.div {...fadeUp}>
            <Badge className="mb-5 px-4 py-1.5 text-sm"><Sparkles className="size-3.5" /> AI-generated house plans from a map</Badge>
          </motion.div>
          <motion.h1 {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.05 }}
            className="max-w-4xl font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Design your home from a{" "}
            <span className="text-brand-gradient">plot on the map</span>.
          </motion.h1>
          <motion.p {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }}
            className="mt-6 max-w-2xl text-lg text-muted-foreground">
            Select your plot, share your requirements, and let our AI engine generate intelligent,
            Vastu-aware 2D floor plans — complete with dimensions, ventilation analysis and pro exports.
          </motion.p>
          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.15 }}
            className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/planner">Generate a plan free <ArrowRight /></Link>
            </Button>
            <Button asChild size="lg" variant="glass">
              <Link href="#features">See how it works</Link>
            </Button>
          </motion.div>

          {/* Hero mock */}
          <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.2 }}
            className="mt-16 w-full max-w-4xl">
            <div className="glass-strong rounded-3xl p-3">
              <div className="rounded-2xl border bg-gradient-to-br from-background to-muted/40 p-6">
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    { l: "Plot area", v: "216 m²" },
                    { l: "Vastu score", v: "82 / 100" },
                    { l: "Generated in", v: "0.4 s" },
                  ].map((s) => (
                    <div key={s.l} className="rounded-xl border bg-card/60 p-4 text-left">
                      <div className="text-xs text-muted-foreground">{s.l}</div>
                      <div className="font-display text-2xl font-bold">{s.v}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-6 gap-2">
                  {["Living", "Kitchen", "Master", "Bed 2", "Bath", "Stair"].map((r, i) => (
                    <div key={r} className="rounded-lg border bg-primary/5 px-2 py-6 text-center text-[11px] font-medium text-primary"
                      style={{ gridColumn: i < 2 ? "span 2" : "span 1" }}>{r}</div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Audience */}
      <section className="container py-12">
        <div className="grid gap-4 sm:grid-cols-3">
          {AUDIENCE.map((a) => (
            <motion.div key={a.title} {...fadeUp}>
              <Card glass className="h-full">
                <CardContent className="flex items-start gap-4 pt-6">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <a.icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-display font-semibold">{a.title}</h3>
                    <p className="text-sm text-muted-foreground">{a.desc}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container py-20">
        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
          <Badge variant="accent" className="mb-3">Features</Badge>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need, from plot to plan
          </h2>
        </motion.div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div key={f.title} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.04 }}>
              <Card className="group h-full transition-shadow hover:shadow-glass-lg">
                <CardContent className="pt-6">
                  <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <f.icon className="size-5" />
                  </span>
                  <h3 className="font-display font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="container py-20">
        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
          <Badge className="mb-3">Pricing</Badge>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Simple, transparent plans</h2>
          <p className="mt-3 text-muted-foreground">Start free. Upgrade when you need unlimited projects and pro exports.</p>
        </motion.div>
        <div className="mx-auto mt-12 grid max-w-5xl gap-5 lg:grid-cols-3">
          {PRICING.map((p) => (
            <motion.div key={p.name} {...fadeUp}>
              <Card glass={p.highlight} className={`relative h-full ${p.highlight ? "ring-2 ring-primary" : ""}`}>
                {p.highlight && <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most popular</Badge>}
                <CardContent className="flex h-full flex-col pt-8">
                  <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="font-display text-4xl font-bold">{p.price}</span>
                    <span className="pb-1 text-sm text-muted-foreground">{p.period}</span>
                  </div>
                  <ul className="mt-6 space-y-3 text-sm">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-center gap-2">
                        <Check className="size-4 text-primary" /> {f}
                      </li>
                    ))}
                  </ul>
                  <Button asChild className="mt-8 w-full" variant={p.highlight ? "default" : "outline"}>
                    <Link href="/planner">{p.cta}</Link>
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="container py-20">
        <div className="grid gap-5 sm:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <motion.div key={t.name} {...fadeUp}>
              <Card className="h-full">
                <CardContent className="pt-6">
                  <p className="text-sm leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
                  <div className="mt-4">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.role}</div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="container py-20">
        <motion.h2 {...fadeUp} className="text-center font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Frequently asked questions
        </motion.h2>
        <div className="mx-auto mt-10 max-w-2xl space-y-3">
          {FAQ.map((f) => (
            <motion.details key={f.q} {...fadeUp} className="group rounded-2xl border bg-card p-5">
              <summary className="flex cursor-pointer items-center justify-between font-medium">
                {f.q}
                <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
            </motion.details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container pb-24">
        <motion.div {...fadeUp} className="glass-strong relative overflow-hidden rounded-3xl px-8 py-16 text-center">
          <div className="absolute inset-0 -z-10 spotlight" />
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Your plot. Your plan. In seconds.</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Join homeowners, builders and architects designing smarter with AI Plot Planner.
          </p>
          <Button asChild size="lg" className="mt-7">
            <Link href="/planner">Generate your first plan <ArrowRight /></Link>
          </Button>
        </motion.div>
      </section>

      <footer className="border-t">
        <div className="container flex flex-col items-center justify-between gap-4 py-8 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} AI Plot Planner. All rights reserved.</span>
          <div className="flex gap-6">
            <Link href="/dashboard" className="hover:text-foreground">Dashboard</Link>
            <Link href="#pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="#faq" className="hover:text-foreground">FAQ</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
