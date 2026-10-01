"use client";

import * as React from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useTheme } from "next-themes";
import { Download, Home, Layers, RotateCcw, Sofa } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildModel, FLOOR_H, type Material, type Model3D } from "@/lib/floorplan/model3d";
import type { PlanResult } from "@/lib/floorplan/types";
import { cn } from "@/lib/utils";

/** Physical-ish colours per surface. */
const COLORS: Record<Material, { color: string; roughness?: number; opacity?: number; metalness?: number }> = {
  wall: { color: "#F4F1EA", roughness: 0.95 },
  wallExt: { color: "#ECE7DD", roughness: 0.9 },
  lintel: { color: "#ECE7DD" },
  railing: { color: "#A9C3D6", roughness: 0.1, metalness: 0.2, opacity: 0.45 }, // glass balustrade
  glass: { color: "#9CC6E6", roughness: 0.05, opacity: 0.35 },
  floorWood: { color: "#C8A27A", roughness: 0.7 },
  floorTile: { color: "#DCE2E6", roughness: 0.4 },
  floorStone: { color: "#D9D4C9", roughness: 0.8 },
  floorDeck: { color: "#A9825C", roughness: 0.8 },
  floorPaving: { color: "#CFC9BD", roughness: 0.95 },
  stair: { color: "#BFB8AA", roughness: 0.85 },
  furniture: { color: "#8E97A6", roughness: 0.7 },
  roof: { color: "#B9B3A7", roughness: 0.9 },
  grass: { color: "#8DB06A", roughness: 1 },
  water: { color: "#4FA3D8", roughness: 0.1, opacity: 0.85 },
  car: { color: "#5A6B82", roughness: 0.35, metalness: 0.5 },
  trunk: { color: "#6E5038", roughness: 0.9 },
  leaves: { color: "#5E8F4E", roughness: 0.9 },
  ground: { color: "#D8D2C2", roughness: 1 },
};

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 16);
const unitSphere = new THREE.SphereGeometry(1, 16, 12);

function useMaterials() {
  return React.useMemo(() => {
    const out = {} as Record<Material, THREE.MeshStandardMaterial>;
    for (const [k, v] of Object.entries(COLORS) as [Material, (typeof COLORS)[Material]][]) {
      out[k] = new THREE.MeshStandardMaterial({
        color: v.color, roughness: v.roughness ?? 0.8, metalness: v.metalness ?? 0,
        transparent: v.opacity !== undefined, opacity: v.opacity ?? 1,
      });
    }
    return out;
  }, []);
}

interface Props {
  plan: PlanResult;
  className?: string;
}

export function Plan3D({ plan, className }: Props) {
  const { resolvedTheme } = useTheme();
  const [upTo, setUpTo] = React.useState(plan.floors.length - 1);
  const [roof, setRoof] = React.useState(false);
  const [furniture, setFurniture] = React.useState(true);
  const [resetKey, setResetKey] = React.useState(0);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const model = React.useMemo(() => buildModel(plan, { furniture }), [plan, furniture]);

  React.useEffect(() => setUpTo(plan.floors.length - 1), [plan]);

  const download = () => {
    const url = canvasRef.current?.toDataURL("image/png");
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = "plan-3d.png";
    a.click();
  };

  return (
    <div className={cn("relative overflow-hidden rounded-lg border", className)}>
      <div className="aspect-[4/3] w-full sm:aspect-[16/10]">
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          onCreated={({ gl }) => { canvasRef.current = gl.domElement; }}
          camera={{ fov: 40, near: 0.1, far: 2000 }}
        >
          <color attach="background" args={[resolvedTheme === "dark" ? "#0F2240" : "#F3F1EA"]} />
          <Scene key={resetKey} model={model} plan={plan} upTo={upTo} roof={roof} />
        </Canvas>
      </div>

      {/* Controls */}
      <div className="absolute inset-x-2 top-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-md border bg-card/90 p-0.5 text-xs shadow-sheet backdrop-blur" role="group" aria-label="Floors shown">
          <Layers className="mx-1.5 size-3.5 text-muted-foreground" aria-hidden />
          {plan.floors.map((f, i) => (
            <button key={f.floor} type="button" onClick={() => setUpTo(i)} aria-pressed={upTo === i}
              className={cn("rounded px-2 py-1 font-medium transition-colors", upTo === i ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground")}>
              {i === plan.floors.length - 1 && i > 0 ? "All floors" : `Up to ${f.name.replace(" Floor", "")}`}
            </button>
          ))}
        </div>
        <Toggle on={roof} onClick={() => setRoof((v) => !v)} icon={<Home className="size-3.5" />} label="Roof" />
        <Toggle on={furniture} onClick={() => setFurniture((v) => !v)} icon={<Sofa className="size-3.5" />} label="Furniture" />
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="glass" onClick={() => setResetKey((k) => k + 1)} aria-label="Reset view"><RotateCcw /></Button>
          <Button size="sm" variant="glass" onClick={download}><Download /> PNG</Button>
        </div>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted-foreground">
        Drag to orbit · scroll to zoom · right-drag to pan
      </p>
    </div>
  );
}

function Toggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium shadow-sheet backdrop-blur transition-colors",
        on ? "bg-accent text-accent-foreground" : "bg-card/90 text-muted-foreground hover:text-foreground")}>
      {icon} {label}
    </button>
  );
}

function Scene({ model, plan, upTo, roof }: { model: Model3D; plan: PlanResult; upTo: number; roof: boolean }) {
  const mats = useMaterials();
  const { camera } = useThree();
  const [cx, cy, cz] = model.center;
  const r = Math.max(model.radius, 8);

  React.useEffect(() => {
    camera.position.set(cx + r * 1.25, cy + r * 1.0, cz + r * 1.35);
    camera.lookAt(cx, cy * 0.5, cz);
  }, [camera, cx, cy, cz, r]);

  // Morning sun from true south-east, converted into the drawing's frame.
  const sun = React.useMemo(() => {
    const bearing = ((135 + (plan.site.northDeg ?? 0)) * Math.PI) / 180;
    return new THREE.Vector3(cx + Math.sin(bearing) * r * 2, r * 2.2, cz - Math.cos(bearing) * r * 2);
  }, [plan.site.northDeg, cx, cz, r]);

  const plot = React.useMemo(() => {
    const shape = new THREE.Shape(plan.site.plot.map(([x, y]) => new THREE.Vector2(x, -y)));
    return new THREE.ShapeGeometry(shape);
  }, [plan.site.plot]);
  const lawn = plan.site.elements.some((e) => e.type === "garden");

  const visible = model.boxes.filter((b) =>
    b.kind === "site" || (b.floor <= upTo && (b.kind !== "roof" || (roof && b.floor === upTo))));
  const rounds = model.rounds.filter((s) => s.kind === "site" || s.floor <= upTo);

  return (
    <>
      <hemisphereLight args={["#FFFFFF", "#B9B09A", 0.75]} />
      <directionalLight
        position={sun}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-r * 1.5}
        shadow-camera-right={r * 1.5}
        shadow-camera-top={r * 1.5}
        shadow-camera-bottom={-r * 1.5}
        shadow-camera-near={0.5}
        shadow-camera-far={r * 8}
        shadow-bias={-0.0005}
      >
        <object3D attach="target" position={[cx, 0, cz]} />
      </directionalLight>

      {/* The plot, in its real shape. */}
      <mesh geometry={plot} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]} receiveShadow material={lawn ? mats.grass : mats.ground} />

      {visible.map((b, i) => (
        <mesh key={i} geometry={unitBox} material={mats[b.material]} position={[b.x, b.y, b.z]} scale={[b.sx, b.sy, b.sz]}
          castShadow={b.kind !== "glass" && b.kind !== "floor"} receiveShadow />
      ))}
      {rounds.map((s, i) => (
        <mesh key={`r${i}`} geometry={s.shape === "sphere" ? unitSphere : unitCyl} material={mats[s.material]}
          position={[s.x, s.y, s.z]} scale={s.shape === "sphere" ? [s.r, s.r * 0.9, s.r] : [s.r, s.h, s.r]} castShadow receiveShadow />
      ))}

      <OrbitControls target={[cx, Math.min(cy, FLOOR_H), cz]} enableDamping maxPolarAngle={Math.PI / 2.05} minDistance={4} maxDistance={r * 6} />
    </>
  );
}
