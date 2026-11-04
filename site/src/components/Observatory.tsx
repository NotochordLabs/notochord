"use client";

import { HeadStatus } from "@/components/LiveStatus";
import { useLiveFeed } from "@/lib/live";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import data from "@/data/experiment.json";
import { CURVE_STEPS, circuitLayout, fibrePoint } from "./circuit";
import Intro, { introSeen } from "./Intro";
import { buildAdult, buildLarva, buildRock } from "./ciona";
import { loadGenome, loadWiring, replay, type Replay, type ThoughtRecord } from "@/lib/engine";
import { dateOf, decisionWord, fmt, useExperiment, signed } from "@/lib/store";

const cells = data.brain.cells;
const STEP_MS = 150;
const BASE: Record<string, string> = { priceUp: "#41d3e6", priceDown: "#41d3e6", volume: "#6e8bff", motorL: "#46e08c", motorR: "#46e08c", other: "#3a5596" };
const ROLE: Record<string, string> = {
  priceUp: "receives rising price", priceDown: "receives falling price", volume: "receives volume",
  motorL: "left motor neuron, sell", motorR: "right motor neuron, buy", other: "interneuron",
};

const CELL_V = `
attribute float size; attribute float glow; attribute vec3 tint;
varying vec3 vTint; varying float vGlow; uniform float scale; uniform float dim;
void main() {
  vTint = tint; vGlow = glow;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (size + glow * 30.0) * scale * dim * 1.5 * 6.0 / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const CELL_F = `
varying vec3 vTint; varying float vGlow;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(0.42, 0.12, d);
  float halo = pow(1.0 - d, 2.4);
  vec3 c = mix(vTint, vec3(1.0, 0.36, 0.60), vGlow);
  gl_FragColor = vec4(c * (core * (0.9 + vGlow) + halo * (0.35 + vGlow * 1.3)) + vec3(1.0) * core * vGlow * 0.6, 1.0);
}`;

type Stage = 0 | 1 | 2;
const STAGES: { name: string; caption: string; note: string }[] = [
  {
    name: "Adult",
    caption: "Adult sea squirt",
    note: "Ciona intestinalis, the adult form, fixed to rock. Schematic model. The adult’s nervous system is not the one mapped here: the wiring in this experiment comes from its larva.",
  },
  {
    name: "Larva",
    caption: "Swimming larva",
    note: "The tadpole larva, about 1 mm long, which swims for some hours before it settles. Schematic model, not to scale with the adult. The notochord has 40 cells as in the animal. Tail muscle lights with this thought’s motor spikes; the steady swim is illustrative.",
  },
  {
    name: "Brain",
    caption: "Neural wiring",
    note: `${data.brain.cells.length} cells and ${data.brain.edges.length / 2} connections (Ryan et al., 2016). Connections and spikes are real data. Cells are arranged by role and by distance from sensory input, not by anatomy. Click a cell to trace it.`,
  },
];

// Stage, name, point on the model, and where its label sits relative to that point in pixels.
// Circuit region labels, in the brain group's coordinates.
const REGIONS: [number, number, string][] = [
  [-1, 0.86, "Sensory input"],
  [-0.1, 0.92, "Interneurons"],
  [1.02, 0.78, "Left motor neurons: sell"],
  [1.02, -0.72, "Right motor neurons: buy"],
];
const LARVA_SCALE = 1.08;
const LARVA_X = 0.3;
const ANATOMY: [number, string, [number, number, number], number, number][] = [
  [0, "Oral siphon", [1.0, 2.1, 0], 86, -10],
  [0, "Atrial siphon", [1.95, 1.2, 0], 44, -30],
  [0, "Branchial basket", [0.6, 0.45, 0], -112, 14],
  [0, "Tunic", [1.46, -0.3, 0], 66, -40],
  [0, "Gut", [1.28, -1.1, 0.1], 90, 40],
  [0, "Gonad", [1.0, -1.08, 0.1], -160, -6],
  [1, "Adhesive palps", [1.66, -0.16, 0], -14, 96],
  [1, "Ocellus (light)", [0.98, 0.2, 0.02], 60, -128],
  [1, "Otolith (gravity)", [0.78, 0.075, 0], -46, -118],
  [1, "Motor ganglion", [0.3, 0.02, 0], -30, 100],
  [1, "Notochord", [-1.1, 0, 0], -30, 90],
  [1, "Tail fin", [-1.85, 0.16, 0], -20, -70],
  [1, "Tail muscle", [-0.75, 0.04, 0.05], 10, -92],
];

const edgesFrom = (c: number) => {
  let n = 0;
  for (let e = 0; e < data.brain.edges.length; e += 2) if (data.brain.edges[e] === c) n++;
  return n;
};
const edgesTo = (c: number) => {
  let n = 0;
  for (let e = 1; e < data.brain.edges.length; e += 2) if (data.brain.edges[e] === c) n++;
  return n;
};

export default function Observatory() {
  const { rep, setRep, gen, selected, archive, market, standing } = useExperiment();
  const host = useRef<HTMLDivElement>(null);
  const raster = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<number[][]>([]);
  const stepRef = useRef(0);
  const stageRef = useRef<Stage>(0);
  const focusRef = useRef<number | null>(null);
  const focusPaint = useRef<() => void>(() => {});
  const gaugeL = useRef<HTMLDivElement>(null);
  const gaugeR = useRef<HTMLDivElement>(null);
  const gaugeStep = useRef<HTMLSpanElement>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const labelsRef = useRef<(HTMLDivElement | null)[]>([]);
  const regionsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [stage, setStage] = useState<Stage>(0);
  // Starts false for the server render; the effect below decides on the client.
  const [intro, setIntro] = useState(false);
  const introRef = useRef(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!introSeen() && !reducedMotion) setIntro(true);
  }, []);
  useEffect(() => {
    introRef.current = intro;
    if (intro) document.body.dataset.intro = "1";
    else delete document.body.dataset.intro;
    return () => {
      delete document.body.dataset.intro;
    };
  }, [intro]);
  const [hour, setHour] = useState(0);
  const [week, setWeek] = useState(false);
  const [run, setRun] = useState<Replay | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [failed, setFailed] = useState(false);

  const hours = week && gen === 99 ? 168 : 24;
  const start = market ? (week && gen === 99 ? market.holdoutOffset : gen * 24) : 0;

  useEffect(() => {
    if (gen !== 99 && week) setWeek(false);
  }, [gen, week]);

  // The real engine, here in the browser. Replicate 1's genomes are in the public archive.
  useEffect(() => {
    if (rep !== 1 || selected === null || !market) {
      setRun(null);
      return;
    }
    let live = true;
    (async () => {
      const [w, genome] = await Promise.all([loadWiring(), loadGenome(selected)]);
      const r = replay(w, genome, market, start, hours);
      if (live) setRun(r);
    })();
    return () => {
      live = false;
    };
  }, [rep, selected, market, start, hours]);

  // Open on an hour where the brain acted, so the first thing seen is a real decision.
  useEffect(() => {
    if (!run) return;
    const acted = run.thoughts.findIndex((t) => t.decision !== 0);
    setHour(acted >= 0 ? acted : 0);
  }, [run]);

  // Live: the latest on-chain hour recomputed here. Larva and brain both draw from `thought`.
  const feed = useLiveFeed();
  const [source, setSource] = useState<"live" | "archive" | null>(null);
  const liveBrain = feed.brain;
  const liveOn = !!liveBrain && (source ?? "live") === "live";
  useEffect(() => {
    if (liveOn) document.body.dataset.live = "1";
    else delete document.body.dataset.live;
    return () => { delete document.body.dataset.live; };
  }, [liveOn]);
  const thought: ThoughtRecord | undefined = liveOn ? liveBrain.run.thoughts[0] : run?.thoughts[Math.min(hour, (run?.thoughts.length ?? 1) - 1)];

  useEffect(() => {
    framesRef.current = thought?.frames ?? [];
    stepRef.current = 0;
    const canvas = raster.current;
    if (!canvas || !thought) return;
    const order = cells.map((c, i) => ({ i, r: ["priceUp", "priceDown", "volume", "other", "motorL", "motorR"].indexOf(c.role) })).sort((a, b) => a.r - b.r || a.i - b.i);
    const y = new Map(order.map((o, k) => [o.i, k]));
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, box.width * ratio);
    canvas.height = Math.max(1, box.height * ratio);
    const g = canvas.getContext("2d")!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    const dx = canvas.width / 32;
    const dy = canvas.height / cells.length;
    thought.frames.forEach((on, s) => {
      for (const c of on) {
        g.fillStyle = cells[c].role === "other" ? "#ff5c9a" : BASE[cells[c].role];
        g.fillRect(s * dx + dx * 0.15, y.get(c)! * dy, dx * 0.7, Math.max(ratio, dy));
      }
    });
    // The bench is hidden on the animal views, where the canvas has no size to draw into.
  }, [thought, stage]);

  useEffect(() => {
    stageRef.current = stage;
    if (stage !== 2 && focusRef.current !== null) {
      focusRef.current = null;
      setFocus(null);
      focusPaint.current();
    }
  }, [stage]);

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    const ratio = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(ratio);
    renderer.setClearColor("#060913");
    renderer.toneMapping = THREE.NoToneMapping;
    el.prepend(renderer.domElement);
    const canvas = renderer.domElement;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.set(-0.7, 0.75, 8.6);
    const controls = new OrbitControls(camera, canvas);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.target.set(-0.25, 0.1, 0);

    const clock = { uTime: { value: 0 }, uDrive: { value: 0 } };
    const adultFade = { value: 1 };
    const larvaFade = { value: 0 };
    const adult = buildAdult(clock, adultFade);
    scene.add(adult);
    // Ciona grows in clusters: fainter neighbours behind the main animal.
    const neighbourFade = { value: 0.3 };
    const neighbours = [
      { x: -1.5, y: -0.83, z: -2.8, s: 0.6, r: 0.1 },
      { x: 3.5, y: -0.9, z: -3.2, s: 0.66, r: -0.14 },
    ].map((n) => {
      const g = buildAdult(clock, neighbourFade, 0);
      g.position.set(n.x, n.y, n.z);
      g.scale.setScalar(n.s);
      g.rotation.set(0, n.r * 8, n.r);
      scene.add(g);
      return g;
    });
    const rock = buildRock(clock, adultFade);
    rock.position.set(0.85, -3.3, -1.3);
    scene.add(rock);

    // Water: light from the surface falling into darkness. Gone inside the brain view.
    const waterU = { uTime: clock.uTime, uLevel: { value: 1 } };
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, uniforms: waterU,
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }",
      fragmentShader: `
        uniform float uTime; uniform float uLevel; varying vec2 vUv;
        void main(){
          float depth = smoothstep(0.0, 1.0, vUv.y);
          vec3 c = mix(vec3(0.008, 0.014, 0.028), vec3(0.016, 0.06, 0.095), depth * depth);
          float shaft = sin(vUv.x * 9.0 + vUv.y * 2.2 + uTime * 0.07) * sin(vUv.x * 17.0 - vUv.y * 3.1 - uTime * 0.05);
          c += vec3(0.012, 0.032, 0.045) * max(0.0, shaft) * depth * depth;
          c *= uLevel;
          gl_FragColor = vec4(c + vec3(0.0018, 0.0028, 0.0065) * (1.0 - uLevel), 1.0);
        }`,
    }));
    water.renderOrder = -10;
    water.frustumCulled = false;
    scene.add(water);

    // Filter feeding: water drawn in through the oral siphon, out through the atrial siphon.
    const feedIn = new THREE.CatmullRomCurve3([[-0.6, 3.6, 1.1], [0.35, 3.15, 0.45], [0.88, 2.5, 0.05], [0.84, 1.7, 0], [0.82, 0.9, 0], [1.08, 0.72, 0.05], [1.5, 1.05, 0.05], [2.25, 1.8, 0.1], [3.3, 2.4, 0.4]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const FEED = 260;
    const feedPos = new Float32Array(FEED * 3);
    const feedGeo = new THREE.BufferGeometry();
    feedGeo.setAttribute("position", new THREE.BufferAttribute(feedPos, 3));
    const feedMat = new THREE.PointsMaterial({ color: "#c8e8ff", size: 0.017, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 });
    const feed = new THREE.Points(feedGeo, feedMat);
    feed.frustumCulled = false;
    scene.add(feed);
    const feedJit: number[] = [];
    let feedSeed = 7;
    const feedRnd = () => ((feedSeed = (feedSeed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < FEED * 4; i++) feedJit.push(feedRnd());
    const feedTmp = new THREE.Vector3();
    const { larva, muscles, pigments } = buildLarva(clock, larvaFade);
    scene.add(larva);

    // Marine snow: drifting particles at different depths, the near ones soft and out of focus.
    const SNOW = 520;
    const snowPos = new Float32Array(SNOW * 3), snowSize = new Float32Array(SNOW);
    let seed = 177;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < SNOW; i++) {
      snowPos[i * 3] = (rnd() - 0.5) * 15;
      snowPos[i * 3 + 1] = (rnd() - 0.5) * 9;
      snowPos[i * 3 + 2] = (rnd() - 0.5) * 12 - 1;
      snowSize[i] = 3 + rnd() ** 4 * 34;
    }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
    snowGeo.setAttribute("size", new THREE.BufferAttribute(snowSize, 1));
    const snowU = { uTime: clock.uTime, uLevel: { value: 1 } };
    const dust = new THREE.Points(snowGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: snowU,
      vertexShader: `attribute float size; uniform float uTime; varying float vS;
        void main(){ vec3 p = position; p.y = mod(p.y + uTime * 0.018 + 4.5, 9.0) - 4.5; p.x += sin(uTime * 0.11 + position.z) * 0.12;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); vS = size; gl_PointSize = size * 9.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uLevel; varying float vS;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
          float a = pow(1.0 - d, 1.6) * (vS > 12.0 ? 0.06 : 0.35);
          gl_FragColor = vec4(vec3(0.5, 0.68, 0.85) * a * uLevel, 1.0); }`,
    }));
    dust.frustumCulled = false;
    scene.add(dust);

    // The real wiring. Inside the larva it is shown small; entering expands it to fill the view.
    const { edges } = data.brain;
    const pos = circuitLayout();
    const brain = new THREE.Group();
    scene.add(brain);
    // Every connection is a curved fibre made of short segments.
    const edgeCount = edges.length / 2;
    const fibreVerts = edgeCount * CURVE_STEPS * 2;
    const edgePos = new Float32Array(fibreVerts * 3);
    const edgeCol = new Float32Array(fibreVerts * 3);
    {
      const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
      for (let e = 0; e < edgeCount; e++) {
        const a = pos[edges[e * 2]], b = pos[edges[e * 2 + 1]];
        for (let k = 0; k < CURVE_STEPS; k++) {
          fibrePoint(a, b, k / CURVE_STEPS, p0).toArray(edgePos, (e * CURVE_STEPS + k) * 6);
          fibrePoint(a, b, (k + 1) / CURVE_STEPS, p1).toArray(edgePos, (e * CURVE_STEPS + k) * 6 + 3);
        }
      }
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
    edgeGeo.setAttribute("color", new THREE.BufferAttribute(edgeCol, 3));
    brain.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })));

    // Signals: one bright point travelling along each fibre whose source cell just fired.
    const PULSES = 420;
    const pulsePos = new Float32Array(PULSES * 3).fill(99);
    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute("position", new THREE.BufferAttribute(pulsePos, 3));
    const pulses = new THREE.Points(pulseGeo, new THREE.PointsMaterial({ color: "#ffd0e2", size: 0.018, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pulses.frustumCulled = false;
    brain.add(pulses);
    let activeFibres: number[] = [];
    let pulseStart = 0;
    const pulseTmp = new THREE.Vector3();
    const pp = new Float32Array(cells.length * 3), tints = new Float32Array(cells.length * 3), sizes = new Float32Array(cells.length), glows = new Float32Array(cells.length);
    cells.forEach((c, i) => {
      pos[i].toArray(pp, i * 3);
      new THREE.Color(BASE[c.role]).toArray(tints, i * 3);
      sizes[i] = c.role === "other" ? 26 : 44;
    });
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute("position", new THREE.BufferAttribute(pp, 3));
    pointGeo.setAttribute("tint", new THREE.BufferAttribute(tints, 3));
    pointGeo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    pointGeo.setAttribute("glow", new THREE.BufferAttribute(glows, 1));
    const scaleU = { value: 1 };
    const uniforms = { dim: { value: 0.28 } };
    const pointsObj = new THREE.Points(pointGeo, new THREE.ShaderMaterial({ vertexShader: CELL_V, fragmentShader: CELL_F, uniforms: { scale: scaleU, dim: uniforms.dim }, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    brain.add(pointsObj);

    const motorL = new Set(data.brain.cells.flatMap((c, i) => (c.role === "motorL" ? [i] : [])));
    const motorR = new Set(data.brain.cells.flatMap((c, i) => (c.role === "motorR" ? [i] : [])));
    let edgeGain = 1;
    const paintEdges = () => {
      const focus = focusRef.current;
      for (let e = 0; e < edgeCount; e++) {
        const from = edges[e * 2], to = edges[e * 2 + 1];
        const g = glows[from];
        let r: number, gr: number, b: number;
        if (focus !== null) {
          // Only this cell's fibres remain: outgoing in magenta, incoming in cyan.
          if (from === focus) { r = 0.75; gr = 0.2; b = 0.42; }
          else if (to === focus) { r = 0.1; gr = 0.5; b = 0.6; }
          else { r = 0.002; gr = 0.003; b = 0.008; }
        } else {
          r = (0.006 + g * 0.1) * edgeGain;
          gr = (0.012 + g * 0.016) * edgeGain;
          b = (0.03 + g * 0.045) * edgeGain;
        }
        const first = e * CURVE_STEPS * 2;
        for (let v = first; v < first + CURVE_STEPS * 2; v++) {
          edgeCol[v * 3] = r;
          edgeCol[v * 3 + 1] = gr;
          edgeCol[v * 3 + 2] = b;
        }
      }
      edgeGeo.attributes.color.needsUpdate = true;
      pointGeo.attributes.glow.needsUpdate = true;
    };
    focusPaint.current = paintEdges;
    paintEdges();

    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.setPixelRatio(ratio);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.55, 0.72);
    composer.addPass(bloom);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Keep the whole animal in frame at any shape, without changing the viewing angle.
      const distance = Math.max(8.6, 6.2 / (0.573 * camera.aspect));
      camera.position.sub(controls.target).setLength(distance).add(controls.target);
      scaleU.value = (h * ratio) / 900;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let tallyL = 0, tallyR = 0;
    let raf = 0, lastFrame = performance.now(), last = performance.now(), progress = 0, left = 0, right = 0;
    const v = new THREE.Vector3();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const target = stageRef.current;
      const dt = Math.min(0.2, (now - lastFrame) / 1000);
      lastFrame = now;
      progress += (target - progress) * (reduced ? 1 : 1 - Math.exp(-dt * 2.4));
      // 0 adult, 1 larva, 2 brain. Each stage dissolves into the next.
      const toLarva = THREE.MathUtils.clamp(progress, 0, 1);
      const blend = THREE.MathUtils.clamp(progress - 1, 0, 1);
      const distance = camera.position.distanceTo(controls.target);
      adultFade.value = Math.max(0, 1 - toLarva * 1.6);
      adult.visible = adultFade.value > 0.002;
      adult.position.set(0.85, -0.15, 0);
      adult.scale.setScalar(0.92 * (1 - toLarva * 0.45));
      neighbourFade.value = 0.26 * adultFade.value;
      neighbours.forEach((n) => (n.visible = adultFade.value > 0.002));
      rock.visible = adult.visible;
      waterU.uLevel.value = 1 - blend;
      snowU.uLevel.value = 1 - blend * 0.75;
      feed.visible = adult.visible && !reduced;
      if (feed.visible) {
        feedMat.opacity = 0.8 * adultFade.value;
        for (let i = 0; i < FEED; i++) {
          const u = (feedJit[i * 4] + now * 0.000028 * (0.8 + feedJit[i * 4 + 1] * 0.5)) % 1;
          feedIn.getPointAt(u, feedTmp);
          const spread = 0.05 + Math.abs(u - 0.33) * 0.28;
          feedPos[i * 3] = feedTmp.x + (feedJit[i * 4 + 2] - 0.5) * spread;
          feedPos[i * 3 + 1] = feedTmp.y + (feedJit[i * 4 + 3] - 0.5) * spread;
          feedPos[i * 3 + 2] = feedTmp.z + (feedJit[(i * 4 + 5) % feedJit.length] - 0.5) * spread;
        }
        feedGeo.attributes.position.needsUpdate = true;
      }
      larvaFade.value = Math.max(0, Math.min(1, toLarva * 1.6 - 0.5)) * Math.max(0, 1 - blend * 1.5);
      larva.visible = larvaFade.value > 0.002;
      larva.scale.setScalar(THREE.MathUtils.lerp(0.55, LARVA_SCALE, toLarva));
      larva.position.x = LARVA_X;
      pigments.forEach((m) => (m.opacity = larvaFade.value));
      brain.visible = toLarva > 0.4;
      const shown = Math.max(0, Math.min(1, toLarva * 1.6 - 0.5));
      brain.position.set(THREE.MathUtils.lerp(0.84, introRef.current ? 0.75 : -0.2, blend), THREE.MathUtils.lerp(0.02, introRef.current ? 0.1 : -0.18, blend), 0);
      brain.scale.setScalar(THREE.MathUtils.lerp(0.13, Math.min(2.7, distance * (introRef.current ? 0.17 : 0.205)), blend));
      edgeGain = THREE.MathUtils.lerp(0.06, 1, blend) * shown;
      uniforms.dim.value = THREE.MathUtils.lerp(0.1, 1, blend) * shown;
      if (now - last >= STEP_MS && !reduced) {
        last = now;
        for (let i = 0; i < glows.length; i++) glows[i] *= 0.62;
        const frames = framesRef.current;
        const s = stepRef.current;
        if (s === 0) tallyL = tallyR = 0;
        activeFibres = [];
        if (s < frames.length) {
          const firing = new Set(frames[s]);
          for (const c of frames[s]) {
            glows[c] = 1;
            if (motorL.has(c)) { left += 1; tallyL++; }
            if (motorR.has(c)) { right += 1; tallyR++; }
          }
          for (let e = 0; e < edgeCount && activeFibres.length < PULSES; e++) if (firing.has(edges[e * 2])) activeFibres.push(e);
        }
        pulseStart = now;
        const top = Math.max(10, frames.reduce((n, on) => n + on.filter((c) => motorL.has(c)).length, 0), frames.reduce((n, on) => n + on.filter((c) => motorR.has(c)).length, 0));
        if (gaugeL.current) gaugeL.current.style.width = `${(tallyL / top) * 100}%`;
        if (gaugeR.current) gaugeR.current.style.width = `${(tallyR / top) * 100}%`;
        if (gaugeStep.current) gaugeStep.current.textContent = `${Math.min(s + 1, frames.length)}/${frames.length}`;
        stepRef.current = s >= frames.length + 10 ? 0 : s + 1;
        left *= 0.7;
        right *= 0.7;
        muscles[0].uniforms.uOpacity.value = 0.14 + Math.min(1.1, left * 0.45);
        muscles[1].uniforms.uOpacity.value = 0.14 + Math.min(1.1, right * 0.45);
        paintEdges();
      }
      if (!reduced) {
        clock.uTime.value = now / 1000;
        clock.uDrive.value += ((right - left) * 0.25 - clock.uDrive.value) * 0.08;
        larva.position.y = Math.sin(now / 2300) * 0.03;
        // The adult is fixed to rock: only a slow lean with the water.
        adult.rotation.z = Math.sin(now / 3800) * 0.012;
        adult.rotation.y = Math.sin(now / 5200) * 0.06;
      }
      // Move each signal along its fibre during the step.
      if (brain.visible && !reduced) {
        const t = Math.min(1, (now - pulseStart) / STEP_MS);
        for (let i = 0; i < PULSES; i++) {
          const e = activeFibres[i];
          if (e === undefined || focusRef.current !== null) {
            pulsePos[i * 3] = 99;
            continue;
          }
          fibrePoint(pos[edges[e * 2]], pos[edges[e * 2 + 1]], t, pulseTmp).toArray(pulsePos, i * 3);
        }
        pulseGeo.attributes.position.needsUpdate = true;
        (pulses.material as THREE.PointsMaterial).opacity = blend;
      }
      controls.autoRotate = introRef.current;
      controls.autoRotateSpeed = 0.5;
      controls.update();
      composer.render();
      REGIONS.forEach(([x, y], i) => {
        const node = regionsRef.current[i];
        if (!node) return;
        v.set(x, y, 0).applyMatrix4(brain.matrixWorld).project(camera);
        node.style.transform = `translate(${((v.x + 1) / 2) * el.clientWidth}px, ${((1 - v.y) / 2) * el.clientHeight}px)`;
        node.style.opacity = introRef.current || focusRef.current !== null ? "0" : String(Math.max(0, blend * 2 - 1));
      });
      ANATOMY.forEach(([stage, , p], i) => {
        const node = labelsRef.current[i];
        if (!node) return;
        v.set(p[0], p[1], p[2]);
        if (stage === 1) v.multiplyScalar(LARVA_SCALE).setX(v.x + LARVA_X);
        v.project(camera);
        node.style.transform = `translate(${((v.x + 1) / 2) * el.clientWidth}px, ${((1 - v.y) / 2) * el.clientHeight}px)`;
        node.style.opacity = introRef.current ? "0" : String(Math.max(0, 1 - Math.abs(progress - stage) * 3));
      });
    };
    raf = requestAnimationFrame(loop);

    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: 0.02 };
    const hit = (e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - box.left) / box.width) * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1), camera);
      return ray.intersectObject(pointsObj)[0]?.index;
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons || stageRef.current !== 2) {
        setTip(null);
        return;
      }
      const i = hit(e);
      canvas.style.cursor = i !== undefined ? "pointer" : "";
      if (i !== undefined) {
        const box = el.getBoundingClientRect();
        setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text: `${cells[i].name}: ${ROLE[cells[i].role]}` });
      } else setTip(null);
    };
    let downAt: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt || stageRef.current !== 2 || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
      const i = hit(e) ?? null;
      focusRef.current = i;
      setFocus(i);
      paintEdges();
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  const stand = selected !== null ? standing(selected) : null;
  const match = run && stand && !week ? run.fitness === stand.f && run.pnl === stand.p : null;
  const holdoutRow = useMemo(() => {
    if (!archive || selected === null) return null;
    const pop = archive.holdout.s.i.includes(selected) ? archive.holdout.s : archive.holdout.c;
    const k = pop.i.indexOf(selected);
    return k >= 0 ? { f: pop.f[k], p: pop.p[k] } : null;
  }, [archive, selected]);
  const weekMatch = run && week && holdoutRow ? run.fitness === holdoutRow.f && run.pnl === holdoutRow.p : null;
  const verified = week ? weekMatch : match;
  const hourTime = market && market.firstTime + (start + hour) * 3600_000;

  return (
    <div className={intro ? "observatory inIntro" : stage === 2 ? "observatory" : "observatory calm"}>
      <div className="scope" ref={host} role="img" aria-label={`${STAGES[stage].caption}: schematic model of Ciona intestinalis.`}>
        {intro && <Intro onStage={setStage} onDone={() => { setIntro(false); setStage(0); }} />}
        <div className={stage === 2 ? "scopeHead compact" : "scopeHead"}>
          <h1>Can a Ciona brain learn the market?</h1>
          <HeadStatus />
        </div>
        {ANATOMY.map(([, name, , dx, dy], i) => (
          <div key={name} className="anatomy" ref={(n) => { labelsRef.current[i] = n; }}>
            <i style={{ width: `${Math.hypot(dx, dy).toFixed(2)}px`, transform: `rotate(${Math.atan2(dy, dx).toFixed(4)}rad)` }} />
            <span style={{ transform: `translate(${dx}px, ${dy}px) translate(${dx < 0 ? "-100%" : "0"}, -50%)` }}>{name}</span>
          </div>
        ))}
        {failed && <p className="fallback">This browser could not open the 3D view. The measurements are in the panel.</p>}
        {tip && <div className="cellTip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
        {REGIONS.map(([, , name], i) => (
          <div key={name} className="region" ref={(n) => { regionsRef.current[i] = n; }}><span>{name}</span></div>
        ))}
        {stage === 2 && !intro && (
          <div className="signal" aria-live="off">
            <div className="signalIn">
              <span>Price this hour <b>{liveOn ? `${signed(liveBrain.r1)} bps` : market ? `${market.r1[start + hour] > 0 ? "+" : ""}${fmt(market.r1[start + hour])} bps` : "…"}</b></span>
              <span>Volume vs 24h <b>{liveOn ? `${signed(liveBrain.dv)} bps` : market ? `${market.dv[start + hour] > 0 ? "+" : ""}${fmt(market.dv[start + hour])} bps` : "…"}</b></span>
              <span>Step <b ref={gaugeStep}>0/32</b></span>
            </div>
            <div className="race">
              <label>Left, sell<div className="track"><div ref={gaugeL} className="bar sellBar" /></div></label>
              <label>Right, buy<div className="track"><div ref={gaugeR} className="bar buyBar" /></div></label>
            </div>
            <div className="verdict"><span>Decision</span><b className={thought?.decision === 1 ? "buy" : thought?.decision === -1 ? "sell" : ""}>{thought ? decisionWord(thought.decision) : "…"}</b></div>
          </div>
        )}
        {stage === 2 && focus !== null && !intro && (
          <div className="focusCard">
            <button aria-label="Close" onClick={() => { focusRef.current = null; setFocus(null); focusPaint.current(); }}>×</button>
            <h3>{cells[focus].name}</h3>
            <p>{ROLE[cells[focus].role]}</p>
            <dl className="facts small">
              <div><dt>Type in the paper</dt><dd>{cells[focus].paperType || "not matched yet"}</dd></div>
              <div><dt>Receives from</dt><dd>{edgesTo(focus)} cells</dd></div>
              <div><dt>Sends to</dt><dd>{edgesFrom(focus)} cells</dd></div>
              <div><dt>Connections from input</dt><dd>{cells[focus].z}</dd></div>
              <div><dt>Spikes this thought</dt><dd>{thought ? thought.frames.filter((f) => f.includes(focus)).length : "…"}/32</dd></div>
            </dl>
            <ul className="legend"><li><span className="swatch" style={{ background: "#ff5c9a" }} />sends</li><li><span className="swatch" style={{ background: "#41d3e6" }} />receives</li></ul>
          </div>
        )}
        <div className="scopeFoot">
          {liveBrain && (
            <div className="lifeCycle" role="group" aria-label="Data source">
              <button aria-pressed={liveOn} onClick={() => setSource("live")}>Live</button>
              <button aria-pressed={!liveOn} onClick={() => setSource("archive")}>Archive</button>
            </div>
          )}
          <div className="lifeCycle" role="group" aria-label="Life stage">
            {STAGES.map((x, i) => (
              <button key={x.name} aria-pressed={stage === i} onClick={() => setStage(i as Stage)}>{x.name}</button>
            ))}
          </div>
          <button className="replayIntro" onClick={() => setIntro(true)}>Replay the story</button>
          <p className="stageNote">{STAGES[stage].note}</p>
        </div>
      </div>

      <aside className="bench">
        {liveOn ? (
          <>
            <div className="block">
              <h3>Live: specimen {liveBrain.specimen}</h3>
              <dl className="readout">
                <div><dt>Decision</dt><dd className={thought?.decision === 1 ? "buy" : thought?.decision === -1 ? "sell" : ""}>{thought ? decisionWord(thought.decision) : "…"}</dd></div>
                <div><dt>Cells fired</dt><dd>{thought?.fired ?? "…"}/{cells.length}</dd></div>
                <div><dt>Right motor</dt><dd>{thought?.motorR ?? "…"}</dd></div>
                <div><dt>Left motor</dt><dd>{thought?.motorL ?? "…"}</dd></div>
              </dl>
            </div>
            <div className="block">
              <h3>Spike raster, 32 steps</h3>
              <canvas ref={raster} className="raster" role="img" aria-label="Which cells fired at each of the 32 steps of this thought." />
            </div>
            <div className={`verify ${liveBrain.agrees ? "" : "bad"}`}>
              <h3>{liveBrain.agrees ? "Matches the chain" : "Does not match the chain"}</h3>
              <p>Generation {liveBrain.generation + 1}, hour {liveBrain.hour + 1}, {new Date(liveBrain.candleMs).toISOString().slice(0, 16).replace("T", " ")} UTC. This browser recomputed the thought from the generation {liveBrain.fossilGeneration + 1} fossil on Elysium and the public HYPE candle. Updates hourly.</p>
            </div>
          </>
        ) : rep !== 1 ? (
          <div className="block">
            <h3>Replicate {rep}</h3>
            <p className="dim">This preview publishes genomes for replicate 1 only, so its thoughts can be recomputed here. Population, lineage and ledger cover all six.</p>
            <button className="enter" onClick={() => setRep(1)}>Switch to replicate 1</button>
          </div>
        ) : (
          <>
            <div className="block">
              <h3>Specimen {selected}, {stand?.population ?? "loading"}</h3>
              <dl className="readout">
                <div><dt>Decision</dt><dd className={thought?.decision === 1 ? "buy" : thought?.decision === -1 ? "sell" : ""}>{thought ? decisionWord(thought.decision) : "…"}</dd></div>
                <div><dt>Cells fired</dt><dd>{thought?.fired ?? "…"}/{cells.length}</dd></div>
                <div><dt>Right motor</dt><dd>{thought?.motorR ?? "…"}</dd></div>
                <div><dt>Left motor</dt><dd>{thought?.motorL ?? "…"}</dd></div>
              </dl>
            </div>

            <div className="block">
              <h3>{hours} hours of decisions{hourTime ? `, now ${new Date(hourTime).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}</h3>
              <div className={hours === 24 ? "strip" : "strip dense"} role="group" aria-label="Hour">
                {run?.thoughts.map((t, h) => (
                  <button key={h} className={`hour d${t.decision}`} aria-pressed={h === hour} aria-label={`Hour ${h + 1}: ${decisionWord(t.decision)}`} onClick={() => setHour(h)} />
                ))}
              </div>
              <ul className="legend">
                <li><span className="swatch" style={{ background: "#46e08c" }} />buy</li>
                <li><span className="swatch" style={{ background: "#ff5c9a" }} />sell</li>
                <li><span className="swatch" style={{ background: "#2a3350" }} />hold</li>
                {gen === 99 && (
                  <li><label className="toggle"><input type="checkbox" checked={week} onChange={(e) => setWeek(e.target.checked)} />unseen week</label></li>
                )}
              </ul>
            </div>

            <div className="block">
              <h3>Spike raster, 32 steps</h3>
              <canvas ref={raster} className="raster" role="img" aria-label="Which cells fired at each of the 32 steps of this thought." />
              <ul className="legend" style={{ marginTop: "0.35rem" }}>
                <li><span className="swatch" style={{ background: "#41d3e6" }} />price</li>
                <li><span className="swatch" style={{ background: "#6e8bff" }} />volume</li>
                <li><span className="swatch" style={{ background: "#ff5c9a" }} />interneuron</li>
                <li><span className="swatch" style={{ background: "#46e08c" }} />motor</li>
              </ul>
            </div>

            <div className={`verify ${verified === false ? "bad" : ""}`}>
              <h3>{verified === null ? "Checking" : verified ? "Recomputed in your browser" : "Mismatch"}</h3>
              <p>
                {run ? <>This browser ran the simulator’s engine on genome {selected}: return {fmt(run.pnl)} bps, fitness {fmt(run.fitness)}. {verified ? "Identical to the archive." : verified === false ? "It differs from the archive." : ""}</> : "Running the engine on this genome."}
              </p>
            </div>
            <p className="dim small">Generation {gen}, {market ? dateOf(market.firstTime + start * 3600_000) : ""}. Pick another specimen on the Population screen.</p>
          </>
        )}
      </aside>
    </div>
  );
}
