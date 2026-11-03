import * as THREE from "three";

/**
 * Schematic Ciona intestinalis models, built from published anatomy: the sessile
 * adult (tunic, two siphons, branchial basket, gut loop) and the swimming larva
 * (trunk, three palps, sensory vesicle, 40-cell notochord, tail muscle, fin).
 * Not to scale between the two: a real larva is about 1 mm, an adult several cm.
 */
const NOISE = `
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }`;

const TISSUE_V = `
uniform float uTime; uniform float uDrive; uniform float uBend; uniform float uSway;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;
float bendAt(float x) {
  float along = clamp((0.25 - x) / 3.4, 0.0, 1.0);
  return uBend * along * along * (sin(x * 2.3 + uTime * 2.4) * 0.3 + uDrive * 0.6 * sin(x * 1.3 + 0.7));
}
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  #endif
  vP = p.xyz; vUv = uv;
  p.z += bendAt(p.x);
  // A resting curve and a slow wave keep the tail from looking like a rod.
  float along2 = clamp((0.2 - p.x) / 3.4, 0.0, 1.0);
  p.y += uBend * along2 * along2 * (0.12 * sin(p.x * 1.5 + uTime * 1.2) - 0.1);
  vec4 w = modelMatrix * p;
  if (uSway > 0.0) {
    // A soft body is never straight, and the free end moves with the water.
    float h = w.y + 2.0;
    w.x += uSway * (0.09 * sin(h * 0.95) + 0.018 * h * h * sin(uTime * 0.55 + h * 0.35));
    w.z += uSway * (0.06 * cos(h * 1.2) + 0.012 * h * h * cos(uTime * 0.41));
  }
  vec4 mv = viewMatrix * w;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const TISSUE_F = `
uniform vec3 uColor; uniform float uOpacity; uniform float uFade; uniform float uRim; uniform float uBody; uniform float uGrain; uniform float uGrid; uniform float uFibre; uniform float uCell; uniform float uRays;
varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec2 vUv;
${NOISE}
// Distance to the nearest cell wall: gives skin the mosaic of a real epithelium.
float walls(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  float a = 8.0, b = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int m = -1; m <= 1; m++) {
    vec3 g = vec3(float(m), float(j), float(k));
    vec3 o = vec3(hash(i + g), hash(i + g + 11.3), hash(i + g + 27.1));
    float d = length(g + o - f);
    if (d < a) { b = a; a = d; } else if (d < b) { b = d; }
  }
  return b - a;
}
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uRim);
  float g = noise(vP * 7.0) * 0.6 + noise(vP * 19.0) * 0.4;
  float tissue = mix(1.0, 0.35 + g * 1.3, uGrain);
  float grid = 1.0;
  if (uGrid > 0.0) {
    float a = abs(sin(vUv.x * 150.0)); float b = abs(sin(vUv.y * 90.0));
    float density = clamp(1.0 - max(fwidth(vUv.x) * 150.0, fwidth(vUv.y) * 90.0) * 0.5, 0.0, 1.0);
    float lines = smoothstep(0.82, 1.0, max(1.0 - a, 1.0 - b)) * 2.4 + 0.12;
    grid = mix(1.0, mix(0.55, lines, density), uGrid);
  }
  float fibre = 1.0;
  if (uFibre > 0.0) {
    // Longitudinal muscle bands and the soft wrinkles of a living tunic.
    float a = atan(vP.z, vP.x);
    float band = smoothstep(0.72, 1.0, abs(sin(a * 11.0 + sin(vP.y * 1.7) * 0.5)));
    float wrinkle = noise(vec3(vP.x * 11.0, vP.y * 2.2, vP.z * 11.0));
    fibre = mix(1.0, 0.45 + band * 1.3 + wrinkle * 0.8, uFibre);
  }
  float cell = 1.0;
  if (uCell > 0.0) {
    float px = length(fwidth(vP)) * uCell;
    float keep = clamp(1.4 - px * 2.2, 0.0, 1.0);
    float w = 1.0 - smoothstep(0.0, 0.09 + px, walls(vP * uCell));
    cell = mix(1.0, 0.5 + w * 2.4 * keep + (1.0 - keep) * 0.35, 0.9);
  }
  float rays = 1.0;
  if (uRays > 0.0) {
    // Fine oblique fibres of the tail fin, fading out at the free edge.
    float edge = sin(vUv.y * 3.14159);
    rays = (0.45 + 0.75 * smoothstep(0.55, 1.0, abs(sin((vP.x + abs(vP.y) * 1.4) * uRays)))) * smoothstep(0.0, 0.45, edge) ;
  }
  // Limit single-fragment brightness: thin edges otherwise flash through the bloom as they move.
  vec3 lit = uColor * (min(f, 0.9) + uBody) * tissue * grid * fibre * cell * rays * uOpacity * uFade;
  gl_FragColor = vec4(min(lit, vec3(0.8)), 1.0);
}`;

export interface CionaUniforms {
  uTime: { value: number };
  uDrive: { value: number };
}

interface TissueOptions { rim?: number; body?: number; grain?: number; grid?: number; bend?: number; fibre?: number; cell?: number; rays?: number }

function tissueFactory(time: CionaUniforms, fade: { value: number }, bend: number, sway = 0) {
  return (color: string, opacity: number, o: TissueOptions = {}) =>
    new THREE.ShaderMaterial({
      vertexShader: TISSUE_V,
      fragmentShader: TISSUE_F,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: time.uTime,
        uDrive: time.uDrive,
        uFade: fade,
        uBend: { value: o.bend ?? bend },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
        uRim: { value: o.rim ?? 2.4 },
        uBody: { value: o.body ?? 0.05 },
        uGrain: { value: o.grain ?? 0.7 },
        uGrid: { value: o.grid ?? 0 },
        uFibre: { value: o.fibre ?? 0 },
        uCell: { value: o.cell ?? 0 },
        uRays: { value: o.rays ?? 0 },
        uSway: { value: sway },
      },
    });
}

function lathe(profile: [number, number][], segments = 72) {
  const curve = new THREE.CatmullRomCurve3(profile.map(([y, r]) => new THREE.Vector3(Math.max(r, 0.0005), y, 0)), false, "catmullrom", 0.4);
  const pts = curve.getPoints(profile.length * 12).map((p) => new THREE.Vector2(Math.max(p.x, 0.0005), p.y));
  return new THREE.LatheGeometry(pts, segments);
}

/** Natural asymmetry: no animal is a perfect solid of revolution. */
function wobble(g: THREE.BufferGeometry, amount: number) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + amount * (Math.sin(y * 3.1 + z * 2.2) + 0.5 * Math.sin(y * 7.3 + x * 4.1));
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/* ---- The adult: wet, translucent tissue under light from the surface ---- */

const LIVING_V = `
uniform float uTime; uniform float uSway; uniform float uBend; uniform float uDrive;
varying vec3 vWN; varying vec3 vWP; varying vec3 vP; varying vec2 vUv;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
  #endif
  vP = p.xyz; vUv = uv;
  if (uBend > 0.0) {
    // The larva's tail: the same wave as its muscles, driven by the motor spikes.
    float along = clamp((0.25 - p.x) / 3.4, 0.0, 1.0);
    p.z += uBend * along * along * (sin(p.x * 2.3 + uTime * 2.4) * 0.3 + uDrive * 0.6 * sin(p.x * 1.3 + 0.7));
    float along2 = clamp((0.2 - p.x) / 3.4, 0.0, 1.0);
    p.y += uBend * along2 * along2 * (0.12 * sin(p.x * 1.5 + uTime * 1.2) - 0.1);
  }
  vec4 w = modelMatrix * p;
  if (uSway > 0.0) {
    // A soft body is never straight, and the free end moves with the water.
    float h = w.y + 2.0;
    w.x += uSway * (0.09 * sin(h * 0.95) + 0.018 * h * h * sin(uTime * 0.55 + h * 0.35));
    w.z += uSway * (0.06 * cos(h * 1.2) + 0.012 * h * h * cos(uTime * 0.41));
  }
  vWP = w.xyz;
  vWN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const LIVING_F = `
uniform vec3 uColor; uniform vec3 uColor2; uniform float uFade; uniform float uAlpha; uniform float uRimAlpha; uniform float uRimPower;
uniform float uSpec; uniform float uBump; uniform float uBumpScale; uniform float uMottle; uniform float uBands; uniform float uLattice; uniform float uFolds;
uniform float uPigFrom; uniform float uPigTo; uniform vec3 uPigment; uniform float uRootFrom; uniform float uRootTo; uniform float uStone; uniform float uBack; uniform float uCell; uniform float uRays;
varying vec3 vWN; varying vec3 vWP; varying vec3 vP; varying vec2 vUv;
${NOISE}
float walls(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  float a = 8.0, b = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int m = -1; m <= 1; m++) {
    vec3 g = vec3(float(m), float(j), float(k));
    vec3 o = vec3(hash(i + g), hash(i + g + 11.3), hash(i + g + 27.1));
    float d = length(g + o - f);
    if (d < a) { b = a; a = d; } else if (d < b) { b = d; }
  }
  return b - a;
}
float lump(vec3 p) { return noise(p) * 0.7 + noise(p * 2.3) * 0.3; }
float fbm(vec3 p) { return noise(p) * 0.55 + noise(p * 2.1 + 3.1) * 0.3 + noise(p * 4.3 + 7.7) * 0.15; }
void main() {
  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWP);
  if (dot(N, V) < 0.0) N = -N;
  if (uBump > 0.0) {
    // Height field read as a normal: the slime and small lumps that catch the light.
    float e = 0.012;
    vec3 q = vP * uBumpScale;
    float h = lump(q);
    vec3 g = vec3(lump(q + vec3(e * uBumpScale, 0, 0)) - h, lump(q + vec3(0, e * uBumpScale, 0)) - h, lump(q + vec3(0, 0, e * uBumpScale)) - h) / e;
    N = normalize(N - g * uBump);
  }
  vec3 L = normalize(vec3(-0.32, 1.0, 0.38));
  vec3 H = normalize(L + V);
  float nl = dot(N, L);
  float wrap = clamp(nl * 0.55 + 0.45, 0.0, 1.0);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uRimPower);

  vec3 albedo = uColor;
  float alpha = mix(uAlpha, uRimAlpha, fres);
  if (uMottle > 0.0) albedo = mix(albedo, uColor2, smoothstep(0.32, 0.72, fbm(vP * 9.0)) * uMottle);
  if (uFolds > 0.0) {
    // Lengthwise folds of the stomach wall.
    float fold = smoothstep(0.2, 0.95, abs(sin(atan(vP.z, vP.x) * 13.0 + vP.y * 3.0)));
    albedo *= 0.62 + 0.55 * mix(1.0, fold, uFolds);
  }
  if (uBands > 0.0) {
    // Pale longitudinal muscle bands of the body wall, branching towards the siphons.
    float a = atan(vP.z, vP.x);
    float wig = (noise(vP * vec3(2.0, 1.4, 2.0)) - 0.5) * 1.5;
    float band = pow(abs(sin(a * 6.5 + wig * 1.6 + 0.15 * vP.y)), 44.0) * (0.45 + 0.55 * noise(vP * vec3(4.0, 1.1, 4.0)));
    float fine = 0.0;
    float m = max(band, fine) * uBands;
    albedo = mix(albedo, uColor2, m);
    alpha = max(alpha, m * 0.3);
  }
  if (uLattice > 0.0) {
    // Gill lattice: fine bars around rows of small slits.
    vec2 c = vec2(vUv.x * 150.0, vUv.y * 52.0);
    float px = max(fwidth(c.x), fwidth(c.y));
    vec2 s = abs(fract(c) - 0.5);
    float slit = smoothstep(0.34 + px * 0.5, 0.2 - px * 0.5, s.x) * smoothstep(0.42 + px * 0.5, 0.3 - px * 0.5, s.y);
    float bar = 1.0 - slit;
    float keep = clamp(1.7 - px * 1.8, 0.0, 1.0);
    alpha *= mix(0.58, 0.22 + bar * 1.35, keep * uLattice);
    albedo *= mix(0.8, 0.72 + bar * 0.45, keep);
  }
  if (uPigTo > uPigFrom) {
    // The margin of each siphon: yellow, deepening to orange at the very edge.
    float t = smoothstep(uPigFrom, uPigTo, vP.y + (noise(vP * 14.0) - 0.5) * 0.05);
    albedo = mix(albedo, uPigment, t);
    albedo = mix(albedo, vec3(0.8, 0.26, 0.05), smoothstep(0.88, 1.0, t) * 0.55);
    alpha = mix(alpha, 0.86, t * t);
  }
  if (uCell > 0.0) {
    // The epidermis, one layer of cells; their walls fade when too small to resolve.
    float px = length(fwidth(vP)) * uCell;
    float keep = clamp(1.4 - px * 2.2, 0.0, 1.0);
    float wall = (1.0 - smoothstep(0.0, 0.1 + px, walls(vP * uCell))) * keep;
    albedo = mix(albedo, uColor2, wall * 0.5);
    alpha += wall * 0.09;
  }
  if (uRays > 0.0) {
    // Fine oblique fibres of the tail fin, thinning out towards the free edge.
    float edge = sin(vUv.y * 3.14159);
    alpha *= (0.42 + 0.7 * smoothstep(0.6, 1.0, abs(sin((vP.x + abs(vP.y) * 1.4) * uRays)))) * smoothstep(0.0, 0.5, edge);
  }
  if (uStone > 0.0) {
    // Patterned in world units: the rock is a stretched sphere.
    float big = smoothstep(0.3, 0.7, fbm(vWP * 0.9));
    float crust = smoothstep(0.55, 0.68, fbm(vWP * 2.1 + 11.0));
    float grit = noise(vWP * 34.0) * 0.6 + noise(vWP * 90.0) * 0.4;
    albedo = mix(uColor, uColor2, big);
    albedo = mix(albedo, vec3(0.12, 0.05, 0.06), crust * 0.4);
    albedo *= 0.72 + grit * 0.5;
    // Where each animal sits, the rock is shaded by it.
    float shade = 1.0;
    shade *= 0.32 + 0.68 * smoothstep(0.42, 1.0, length((vWP.xz - vec2(0.85, 0.0)) / vec2(0.82, 0.68)));
    shade *= 0.45 + 0.55 * smoothstep(0.42, 1.0, length((vWP.xz - vec2(-1.5, -2.8)) / vec2(0.5, 0.42)));
    shade *= 0.45 + 0.55 * smoothstep(0.42, 1.0, length((vWP.xz - vec2(3.5, -3.2)) / vec2(0.55, 0.46)));
    albedo *= shade;
  }

  // Blue fill from the water, warmer light from the surface; light that passes through thin tissue.
  vec3 ambient = vec3(0.1, 0.19, 0.25);
  vec3 sun = vec3(1.0, 0.98, 0.88) * 1.02;
  vec3 c = albedo * (ambient + sun * wrap * wrap);
  c += albedo * vec3(0.5, 0.72, 0.68) * pow(clamp(dot(V, -L) * 0.5 + 0.5, 0.0, 1.0), 2.5) * (fres * 0.45 + 0.08);
  c *= mix(1.0, 0.52 + 0.48 * clamp(vP.y * 0.28 + 0.7, 0.0, 1.0), 0.5);
  float highlight = pow(max(dot(N, H), 0.0), 72.0) * 0.5 + pow(max(dot(N, H), 0.0), 420.0) * 1.1;
  c += vec3(0.92, 0.98, 1.0) * highlight * uSpec;
  alpha = clamp(alpha + highlight * uSpec * 0.55, 0.0, 1.0);
  if (!gl_FrontFacing) { c *= uBack; }
  if (uRootTo > uRootFrom) alpha *= smoothstep(uRootFrom, uRootTo, vP.y);
  gl_FragColor = vec4(min(c, vec3(1.0)), alpha * uFade);
}`;

interface LivingOptions {
  color2?: string; alpha?: number; rimAlpha?: number; rimPower?: number; spec?: number; bump?: number; bumpScale?: number; mottle?: number; bands?: number; lattice?: number; folds?: number;
  pigFrom?: number; pigTo?: number; pigment?: string; rootFrom?: number; rootTo?: number; stone?: number; back?: number; side?: THREE.Side; solid?: boolean; cell?: number; rays?: number;
}

function livingFactory(time: CionaUniforms, fade: { value: number }, sway: number, bend = 0) {
  return (color: string, o: LivingOptions = {}) => new THREE.ShaderMaterial({
    vertexShader: LIVING_V,
    fragmentShader: LIVING_F,
    transparent: true,
    depthWrite: !!o.solid,
    side: o.side ?? THREE.FrontSide,
    uniforms: {
      uTime: time.uTime, uSway: { value: sway }, uBend: { value: bend }, uDrive: time.uDrive, uFade: fade, uCell: { value: o.cell ?? 0 }, uRays: { value: o.rays ?? 0 },
      uColor: { value: new THREE.Color(color) }, uColor2: { value: new THREE.Color(o.color2 ?? color) },
      uAlpha: { value: o.alpha ?? 1 }, uRimAlpha: { value: o.rimAlpha ?? o.alpha ?? 1 }, uRimPower: { value: o.rimPower ?? 2.2 },
      uSpec: { value: o.spec ?? 0.5 }, uBump: { value: o.bump ?? 0 }, uBumpScale: { value: o.bumpScale ?? 7 },
      uMottle: { value: o.mottle ?? 0 }, uBands: { value: o.bands ?? 0 }, uLattice: { value: o.lattice ?? 0 }, uFolds: { value: o.folds ?? 0 },
      uPigFrom: { value: o.pigFrom ?? 0 }, uPigTo: { value: o.pigTo ?? 0 }, uPigment: { value: new THREE.Color(o.pigment ?? "#e8b92e") },
      uRootFrom: { value: o.rootFrom ?? 0 }, uRootTo: { value: o.rootTo ?? 0 }, uStone: { value: o.stone ?? 0 }, uBack: { value: o.back ?? 0.72 },
    },
  });
}

/** Folds, creases and uneven swelling. Periodic around the body, so there is no seam. */
function fleshy(g: THREE.BufferGeometry, amount: number, phase = 0) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const lower = Math.max(0, Math.min(1, (0.9 - y) / 2.2));
    const swell = 0.055 * Math.sin(a * 2 + y * 0.9 + phase) + 0.04 * Math.sin(a * 3 - y * 1.4 + phase * 2) + 0.018 * Math.sin(a * 7 + y * 2.3);
    const crease = -0.05 * Math.pow(Math.abs(Math.cos(a * 4 + y * 0.7 + phase)), 14);
    const ring = 0.007 * lower * Math.sin(y * 9 + 2.2 * Math.sin(a * 2 + phase)) + 0.004 * lower * Math.sin(y * 23 + a * 3);
    const k = 1 + amount * (swell + crease + ring);
    p.setXYZ(i, x * k, y, z * k);
  }
  return g;
}

/** The two ends of a lathe share positions but not normals; average them to hide the join. */
function closeSeam(g: THREE.BufferGeometry, rows: number) {
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const columns = n.count / rows;
  for (let r = 0; r < rows; r++) {
    const a = r, b = (columns - 1) * rows + r;
    const v = new THREE.Vector3(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  }
  return g;
}

/** A lathe with the points at a fixed count, so its rows are known. */
function body(profile: [number, number][], segments: number) {
  const curve = new THREE.CatmullRomCurve3(profile.map(([y, r]) => new THREE.Vector3(Math.max(r, 0.0005), y, 0)), false, "catmullrom", 0.4);
  const rows = profile.length * 16 + 1;
  const pts = curve.getPoints(rows - 1).map((v) => new THREE.Vector2(Math.max(v.x, 0.0005), v.y));
  return { geometry: new THREE.LatheGeometry(pts, segments), rows };
}

/** Rounded lobes at an opening, each dipping at its notch. */
function lobes(g: THREE.BufferGeometry, from: number, to: number, count: number, depth: number, lift: number) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = Math.max(0, Math.min(1, (y - from) / (to - from)));
    const c = Math.cos(Math.atan2(z, x) * count);
    const shape = c;
    p.setXYZ(i, x * (1 + depth * t * t * shape), y + lift * t * t * (shape - 0.2), z * (1 + depth * t * t * shape));
  }
  return g;
}

export function buildAdult(time: CionaUniforms, fade: { value: number }, detail = 1) {
  const live = livingFactory(time, fade, 1);
  const adult = new THREE.Group();
  const add = (g: THREE.BufferGeometry, m: THREE.Material, order: number, parent: THREE.Object3D = adult) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = order;
    parent.add(mesh);
    return mesh;
  };
  const phase = detail ? 0.4 : 2.1;
  const seg = detail ? 128 : 56;

  const TUNIC: [number, number][] = [[-2.08, 0.5], [-1.98, 0.5], [-1.72, 0.56], [-1.3, 0.61], [-0.7, 0.62], [-0.05, 0.585], [0.55, 0.51], [1.05, 0.405], [1.45, 0.295], [1.85, 0.215], [2.22, 0.17], [2.47, 0.185], [2.58, 0.24]];
  const shell = (profile: [number, number][], amount: number, rimStart: number, rimEnd: number, count: number, depth: number, lift: number) => {
    const { geometry, rows } = body(profile, seg);
    fleshy(geometry, amount, phase);
    lobes(geometry, rimStart, rimEnd, count, depth, lift);
    return closeSeam(geometry, rows);
  };

  // Interior, nearest the middle first. Each layer draws over what is inside it.
  // The throat is dark, so the oral siphon reads as an opening rather than a cap.
  add(shell([[1.55, 0.09], [1.95, 0.12], [2.25, 0.125], [2.48, 0.14]], 0.4, 2.3, 2.48, 8, 0.1, 0.02),
    live("#1c1411", { alpha: 0.82, spec: 0.1, side: THREE.DoubleSide, back: 1, pigFrom: 2.3, pigTo: 2.48, pigment: "#6d3e16", rootFrom: 1.75, rootTo: 2.4 }), 1);

  // Gut: a mottled stomach and the intestine looping back up to the atrial chamber.
  const gutMat = live("#7b3512", { color2: "#c86b24", mottle: 1, alpha: 0.97, rimAlpha: 1, spec: 0.7, bump: 0.014, bumpScale: 13, solid: true });
  const gutPath = [[-0.1, -0.72, 0.15], [-0.36, -0.92, 0.2], [-0.4, -1.32, 0.04], [-0.06, -1.52, -0.12], [0.3, -1.33, -0.1], [0.36, -0.9, 0.06], [0.2, -0.56, 0.2], [0.26, 0.15, 0.27], [0.31, 0.72, 0.2]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const gutRadius = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(gutPath), 200, 0.055, 14);
  add(gutRadius, gutMat, 2);
  const stomach = new THREE.SphereGeometry(0.235, 48, 32);
  stomach.scale(1.18, 0.92, 0.84);
  stomach.rotateZ(-0.35);
  stomach.translate(-0.2, -1.08, 0.05);
  stomach.computeVertexNormals();
  add(stomach, live("#7c3714", { color2: "#a95422", mottle: 0.75, alpha: 1, spec: 0.7, folds: 1, bump: 0.01, bumpScale: 17, solid: true }), 2);

  if (detail) {
    // Gonad: a pale lobed mass in the gut loop, with ducts running alongside the intestine.
    const count = 150;
    const gonad = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), live("#eee0ac", { color2: "#cda863", mottle: 0.6, alpha: 0.96, spec: 0.5, solid: true }), count);
    const d = new THREE.Object3D();
    let seed = 41;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const a = r() * 6.28, h = r();
      d.position.set(0.1 + Math.cos(a) * 0.2 * Math.sqrt(r()), -1.2 + h * 0.5, -0.03 + Math.sin(a) * 0.15 * Math.sqrt(r()));
      d.scale.setScalar(0.02 + r() * 0.024);
      d.updateMatrix();
      gonad.setMatrixAt(i, d.matrix);
    }
    gonad.renderOrder = 2;
    adult.add(gonad);
    const duct = (off: number, color: string, radius: number) => {
      const pts = [[0.1, -0.75, 0.16], [0.17, -0.5, 0.25], [0.24, 0.15, 0.32], [0.3, 0.78, 0.24 + off]].map(([x, y, z]) => new THREE.Vector3(x + off, y, z + off));
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, radius, 8), live(color, { color2: "#d7421b", alpha: 0.95, spec: 0.5, solid: true, pigFrom: 0.42, pigTo: 0.78, pigment: "#d9441c" }), 2);
    };
    duct(0.06, "#d9c78f", 0.013);
    duct(-0.05, "#e8dfc3", 0.008);
  }

  // Branchial basket: the gill lattice filling most of the body.
  const basketShape = body([[-0.72, 0.05], [-0.5, 0.4], [0.1, 0.46], [0.8, 0.36], [1.3, 0.21], [1.62, 0.11]], seg);
  fleshy(basketShape.geometry, 0.3, phase);
  closeSeam(basketShape.geometry, basketShape.rows);
  add(basketShape.geometry, live("#bcc6a4", { alpha: 0.17, rimAlpha: 0.3, spec: 0.1, lattice: detail ? 0.75 : 0.3, side: THREE.DoubleSide, back: 0.6 }), 3);

  if (detail) {
    // Endostyle: the pale groove down the front of the basket.
    const endostyle = new THREE.CatmullRomCurve3([[-0.28, 1.3, 0.1], [-0.42, 0.55, 0.16], [-0.47, -0.15, 0.14], [-0.34, -0.62, 0.05]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    add(new THREE.TubeGeometry(endostyle, 80, 0.016, 8), live("#e6dfc0", { alpha: 0.38, spec: 0.2 }), 3);
  }

  // Body wall, with its muscle bands.
  add(shell([[-1.92, 0.3], [-1.5, 0.52], [-0.8, 0.56], [-0.1, 0.525], [0.55, 0.455], [1.05, 0.35], [1.45, 0.245], [1.9, 0.17], [2.45, 0.15]], 0.8, 2.2, 2.45, 8, 0.1, 0.02),
    live("#c9bc86", { color2: "#ece4c2", alpha: 0.07, rimAlpha: 0.26, spec: 0.08, bands: 0.8, side: THREE.DoubleSide, pigFrom: 2.1, pigTo: 2.42 }), 4);

  // Atrial siphon, off to one side and leaving the body at a slant.
  const atrialGroup = new THREE.Group();
  atrialGroup.position.set(0.36, 0.98, 0.06);
  atrialGroup.rotation.z = -0.8;
  adult.add(atrialGroup);
  const atrialShell = (profile: [number, number][], from: number, to: number) => {
    const { geometry, rows } = body(profile, detail ? 72 : 40);
    fleshy(geometry, 0.55, phase + 1);
    lobes(geometry, from, to, 6, 0.1, 0.025);
    return closeSeam(geometry, rows);
  };
  add(atrialShell([[0.25, 0.08], [0.55, 0.075], [0.82, 0.095]], 0.65, 0.82),
    live("#1c1411", { alpha: 0.82, spec: 0.1, side: THREE.DoubleSide, back: 1, pigFrom: 0.68, pigTo: 0.82, pigment: "#6d3e16", rootFrom: 0.3, rootTo: 0.75 }), 4, atrialGroup);
  const atrialProfile: [number, number][] = [[-0.36, 0.2], [0.0, 0.19], [0.4, 0.135], [0.72, 0.112], [0.9, 0.16]];
  const atrial = atrialShell(atrialProfile, 0.7, 0.9);
  const atrialTissue = { alpha: 0.13, rimAlpha: 0.82, rimPower: 1.9, spec: 0.85, bump: 0.008, bumpScale: 9, pigFrom: 0.76, pigTo: 0.93, rootFrom: -0.2, rootTo: 0.12 };
  add(atrial, live("#b9c58f", { ...atrialTissue, side: THREE.BackSide }), 5, atrialGroup);
  add(atrial, live("#ccd49c", atrialTissue), 7, atrialGroup);

  // Tunic: one soft, slimy piece from the holdfast to the lobes of the oral siphon.
  const tunic = shell(TUNIC, 1, 2.34, 2.58, 8, 0.1, 0.03);
  const tunicTissue = { alpha: 0.1, rimAlpha: 0.82, rimPower: 2.1, spec: 0.95, bump: 0.009, bumpScale: 8, pigFrom: 2.42, pigTo: 2.6 };
  add(tunic, live("#a9b67e", { ...tunicTissue, side: THREE.BackSide }), 5);
  add(tunic, live("#c7d097", tunicTissue), 6);

  // Small orange-red ocelli in the notches between the lobes.
  const spots = (parent: THREE.Object3D, y: number, r: number, n: number, size: number) => {
    const material = live("#e23f12", { alpha: 1, spec: 0.6, solid: true });
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), material);
      dot.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      dot.renderOrder = 8;
      parent.add(dot);
    }
  };
  spots(adult, 2.525, 0.222, 8, 0.012);
  spots(atrialGroup, 0.86, 0.15, 6, 0.0095);
  return adult;
}

/** Rock the colony grows on. It does not sway, and light does not pass through it. */
export function buildRock(time: CionaUniforms, fade: { value: number }) {
  const live = livingFactory(time, fade, 0);
  const g = new THREE.SphereGeometry(1, 220, 110);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.12 * Math.sin(x * 4.3 + z * 2.7) + 0.075 * Math.sin(z * 9.1 + x * 6.3 + y * 2) + 0.04 * Math.sin(x * 19 + y * 11 + z * 5) + 0.018 * Math.sin(x * 43 + z * 37) + 0.012 * Math.sin(z * 71 + y * 29 + x * 13);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  const rock = new THREE.Mesh(g, live("#2d3134", { color2: "#524a3f", alpha: 1, spec: 0.12, bump: 0.05, bumpScale: 11, stone: 1, solid: true }));
  rock.renderOrder = 0;
  rock.scale.set(7, 1.6, 3.5);
  return rock;
}

export function buildLarva(time: CionaUniforms, fade: { value: number }) {
  const tissue = tissueFactory(time, fade, 1);
  const live = livingFactory(time, fade, 0, 1);
  const larva = new THREE.Group();
  const add = (mesh: THREE.Mesh, order: number) => { mesh.renderOrder = order; larva.add(mesh); return mesh; };
  // Lathes are drawn along y; negative y becomes the anterior, +x, end.
  const toAxis = (g: THREE.BufferGeometry) => g.rotateZ(Math.PI / 2);
  const d = new THREE.Object3D();
  let seed = 177;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  /** The trunk is not symmetrical: rounded back, deeper belly, head tilted slightly down. */
  const shapeTrunk = (g: THREE.BufferGeometry) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      let y = p.getY(i);
      if (x > 0) {
        const t = Math.min(1, x / 1.8);
        if (y < 0) y *= 1 + 0.2 * Math.sin(t * Math.PI);
        else y *= 1 - 0.06 * Math.sin(t * Math.PI);
        y -= 0.1 * t * t;
      }
      p.setY(i, y);
    }
    g.computeVertexNormals();
    return g;
  };

  const body = shapeTrunk(toAxis(lathe([
    [-1.74, 0.002], [-1.66, 0.12], [-1.42, 0.27], [-1.08, 0.39], [-0.72, 0.42], [-0.4, 0.33], [-0.16, 0.19], [0.03, 0.135],
    [0.6, 0.118], [1.3, 0.095], [2.0, 0.07], [2.7, 0.042], [3.25, 0.01],
  ], 96)));
  body.scale(1, 1, 0.8);
  const skin = { color2: "#dfe7df", alpha: 0.075, rimAlpha: 0.66, rimPower: 2.4, spec: 0.28, bump: 0.003, bumpScale: 13, cell: 24 };
  add(new THREE.Mesh(body, live("#b8c4b9", { ...skin, side: THREE.BackSide })), 4);
  add(new THREE.Mesh(body, live("#d4dcd0", skin)), 6);

  // Outer tunic: a clear, thin coat with almost no structure.
  const coat = shapeTrunk(toAxis(lathe([
    [-1.84, 0.002], [-1.74, 0.17], [-1.46, 0.33], [-1.08, 0.46], [-0.7, 0.49], [-0.36, 0.38], [-0.08, 0.21], [0.1, 0.16],
  ], 96)));
  coat.scale(1, 1, 0.82);
  add(new THREE.Mesh(coat, live("#dfe8e4", { alpha: 0.025, rimAlpha: 0.32, rimPower: 3.2, spec: 0.8 })), 7);

  // Tail fin: a clear sheet, widest in the middle, with fine oblique fibres.
  const fin = new THREE.PlaneGeometry(3.42, 1, 180, 12);
  const fp = fin.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i), u = Math.min(1, Math.max(0, (x + 1.71) / 3.42));
    const half = 0.05 + 0.2 * Math.sin(Math.min(1, u * 1.04) * Math.PI) ** 0.62 * (0.5 + u * 0.5);
    fp.setY(i, fp.getY(i) * 2 * half * Math.min(1, u * 40 + 0.04));
    fp.setX(i, x - 1.56);
  }
  fin.computeVertexNormals();
  add(new THREE.Mesh(fin, live("#dbe4df", { alpha: 0.26, rimAlpha: 0.36, spec: 0.35, rays: 62, side: THREE.DoubleSide, back: 0.9 })), 3);

  // Three adhesive palps: real, but only low domes on the snout, inside the clear coat.
  [[1.68, 0.03, 0], [1.65, -0.2, 0.1], [1.65, -0.2, -0.1]].forEach(([x, y, z]) => {
    const palp = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), live("#e6ece2", { alpha: 0.3, rimAlpha: 0.7, spec: 0.7 }));
    palp.renderOrder = 5;
    palp.position.set(x, y, z);
    palp.scale.set(0.085, 0.05, 0.05);
    larva.add(palp);
  });

  // Sensory vesicle: a thin clear sac, not a ball.
  const vesicle = new THREE.Mesh(wobble(new THREE.SphereGeometry(0.2, 40, 28), 0.04), live("#c3dadb", { alpha: 0.08, rimAlpha: 0.55, spec: 0.8 }));
  vesicle.renderOrder = 3;
  vesicle.position.set(0.86, 0.13, 0);
  vesicle.scale.set(1.28, 0.8, 0.8);
  larva.add(vesicle);
  const pigmentMaterial = () => new THREE.MeshBasicMaterial({ color: "#120c09", transparent: true, depthWrite: false });
  const pigments: THREE.MeshBasicMaterial[] = [];
  // Otolith: one small round statocyte low in the vesicle, on a thin foot.
  const otolithMat = pigmentMaterial();
  pigments.push(otolithMat);
  const otolith = new THREE.Mesh(new THREE.SphereGeometry(0.034, 20, 16), otolithMat);
  otolith.position.set(0.78, 0.075, 0);
  otolith.renderOrder = 7;
  larva.add(otolith);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.05, 8), tissue("#d9e8f2", 0.6, { rim: 1, body: 0.5, grain: 0 }));
  foot.position.set(0.78, 0.035, 0);
  larva.add(foot);
  // Ocellus: a pigment cup high in the vesicle, opening towards a small clear lens.
  const cupMat = pigmentMaterial();
  pigments.push(cupMat);
  const cup = new THREE.Mesh(new THREE.SphereGeometry(0.05, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), cupMat);
  cup.position.set(0.98, 0.195, 0.02);
  cup.rotation.z = 1.9;
  cup.scale.set(1, 0.85, 1);
  cup.renderOrder = 7;
  larva.add(cup);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), live("#e8f2ee", { alpha: 0.25, rimAlpha: 0.75, spec: 1 }));
  lens.renderOrder = 5;
  lens.position.set(0.95, 0.17, 0.03);
  larva.add(lens);

  // Endoderm and mesenchyme: many small pale cells, clustered in the back and belly of the trunk.
  const CELLS = 300;
  const endoderm = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), live("#b9ab8a", { color2: "#dcd0ae", mottle: 0.5, alpha: 0.6, rimAlpha: 0.8, spec: 0.25 }), CELLS);
  endoderm.renderOrder = 2;
  for (let i = 0; i < CELLS; i++) {
    const a = r() * 6.28, b = Math.acos(2 * r() - 1), rr = Math.cbrt(r());
    const inBelly = i % 3 > 0;
    d.position.set(
      (inBelly ? 0.56 : 0.72) + Math.sin(b) * Math.cos(a) * rr * (inBelly ? 0.36 : 0.5),
      (inBelly ? -0.13 : -0.16) + Math.cos(b) * rr * (inBelly ? 0.16 : 0.13),
      Math.sin(b) * Math.sin(a) * rr * 0.25,
    );
    d.scale.setScalar(inBelly ? 0.015 + r() * 0.013 : 0.01 + r() * 0.008);
    d.updateMatrix();
    endoderm.setMatrixAt(i, d.matrix);
  }
  larva.add(endoderm);

  // Notochord: exactly 40 thin stacked cells, as in the animal, inside a faint sheath.
  const noto = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), live("#ece6d2", { alpha: 0.52, rimAlpha: 0.85, spec: 0.75 }), 40);
  noto.renderOrder = 3;
  for (let i = 0; i < 40; i++) {
    const u = i / 39;
    const radius = 0.056 * (1 - u * 0.82);
    d.position.set(0.14 - u * 3.08, 0, 0);
    d.scale.set(0.0395, radius, radius);
    d.updateMatrix();
    noto.setMatrixAt(i, d.matrix);
  }
  larva.add(noto);
  const sheath = toAxis(lathe([[-0.17, 0.002], [-0.14, 0.06], [0.5, 0.054], [1.5, 0.036], [2.5, 0.018], [2.97, 0.003]], 24));
  add(new THREE.Mesh(sheath, live("#dfe5e0", { alpha: 0.05, rimAlpha: 0.4, spec: 0.4 })), 3);

  // Tail muscle: three rows of long overlapping cells on each side, lit by that side's motor spikes.
  const muscles = [0.056, -0.056].map((side) => {
    const material = tissue("#a6edc6", 0.1, { rim: 1.2, body: 0.22, grain: 0.3 });
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), material, 54);
    for (let i = 0; i < 54; i++) {
      const row = i % 3;
      const u = Math.floor(i / 3) / 17 + (row === 1 ? 0.025 : 0);
      const w = 1 - u * 0.84;
      d.position.set(0.05 - u * 3.0, (row - 1) * 0.044 * w, side * w);
      d.scale.set(0.11, 0.024 * w, 0.012);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    }
    mesh.renderOrder = 4;
    larva.add(mesh);
    return material;
  });

  return { larva, muscles, pigments };
}
