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

/** Soft lobes on a siphon's opening: Ciona has eight on the oral siphon, six on the atrial. */
function lobed(g: THREE.BufferGeometry, from: number, to: number, lobes: number, depth: number) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = Math.max(0, Math.min(1, (y - from) / (to - from)));
    const k = 1 + depth * t * t * Math.cos(Math.atan2(z, x) * lobes);
    p.setXYZ(i, x * k, y + 0.05 * t * Math.cos(Math.atan2(z, x) * lobes), z * k);
  }
  g.computeVertexNormals();
  return g;
}

function lobedRim(radius: number, lobes: number, depth: number) {
  const pts = Array.from({ length: 96 }, (_, i) => {
    const a = (i / 96) * Math.PI * 2;
    const r = radius * (1 + depth * Math.cos(a * lobes));
    return new THREE.Vector3(Math.cos(a) * r, 0.05 * Math.cos(a * lobes), Math.sin(a) * r);
  });
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 192, 0.011, 8, true);
}

export function buildAdult(time: CionaUniforms, fade: { value: number }, detail = 1) {
  const tissue = tissueFactory(time, fade, 0, 1);
  const adult = new THREE.Group();

  // Tunic: one soft piece from the holdfast up through the long oral siphon.
  const tunic = lobed(wobble(lathe([[-2.05, 0.34], [-1.86, 0.47], [-1.45, 0.58], [-0.8, 0.6], [-0.1, 0.57], [0.55, 0.5], [1.05, 0.4], [1.45, 0.29], [1.85, 0.21], [2.25, 0.17], [2.5, 0.2], [2.6, 0.26]], 96), 0.045), 2.25, 2.6, 8, 0.2);
  adult.add(new THREE.Mesh(tunic, tissue("#d4e8b6", 0.46, { rim: 2.0, body: 0.05, grain: 0.9, fibre: 0.35 })));
  const inner = lobed(wobble(lathe([[-1.9, 0.22], [-1.4, 0.5], [-0.8, 0.53], [-0.1, 0.5], [0.55, 0.43], [1.05, 0.33], [1.45, 0.23], [1.9, 0.16], [2.5, 0.14]], 96), 0.04), 2.1, 2.5, 8, 0.12);
  adult.add(new THREE.Mesh(inner, tissue("#efe2a0", 0.32, { rim: 1.5, body: 0.035, grain: 0.7, fibre: 1 })));

  // Branchial basket: the gill lattice that fills most of the body.
  const basket = lathe([[-0.72, 0.04], [-0.5, 0.38], [0.1, 0.43], [0.8, 0.33], [1.3, 0.2], [1.62, 0.11]], 96);
  adult.add(new THREE.Mesh(basket, tissue("#d6e8f7", 0.22, { rim: 1.0, body: 0.2, grain: 0.5, grid: 1 })));

  // Atrial siphon: shorter, set to one side.
  const atrial = lobed(wobble(lathe([[-0.3, 0.19], [0.05, 0.18], [0.45, 0.135], [0.74, 0.11], [0.9, 0.15]], 64), 0.03), 0.68, 0.9, 6, 0.2);
  const atrialMesh = new THREE.Mesh(atrial, tissue("#d4e8b6", 0.6, { rim: 2.0, body: 0.05, grain: 0.9, fibre: 0.3 }));
  atrialMesh.position.set(0.37, 1.02, 0.05);
  atrialMesh.rotation.z = -0.82;
  adult.add(atrialMesh);

  // Siphon rims: a thin yellow edge with orange pigment spots between the lobes.
  const rim = (parent: THREE.Object3D, y: number, r: number, lobes: number) => {
    const ring = new THREE.Mesh(lobedRim(r, lobes, 0.2), tissue("#ffd65c", 0.9, { rim: 0.8, body: 0.55, grain: 0.3 }));
    ring.position.y = y;
    parent.add(ring);
    for (let i = 0; i < lobes; i++) {
      const a = ((i + 0.5) / lobes) * Math.PI * 2;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), tissue("#ff6a22", 1.5, { rim: 0.6, body: 0.8, grain: 0 }));
      dot.position.set(Math.cos(a) * r * 0.92, y - 0.035, Math.sin(a) * r * 0.92);
      parent.add(dot);
    }
  };
  rim(adult, 2.6, 0.26, 8);
  const atrialRim = new THREE.Group();
  atrialRim.position.copy(atrialMesh.position);
  atrialRim.rotation.copy(atrialMesh.rotation);
  adult.add(atrialRim);
  rim(atrialRim, 0.9, 0.15, 6);

  // Gut: stomach, then the intestine looping up to the atrial chamber.
  const gutCurve = new THREE.CatmullRomCurve3([[-0.1, -0.72, 0.15], [-0.36, -0.92, 0.2], [-0.4, -1.32, 0.04], [-0.06, -1.52, -0.12], [0.3, -1.33, -0.1], [0.36, -0.9, 0.06], [0.2, -0.56, 0.2], [0.26, 0.15, 0.27], [0.31, 0.72, 0.2]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  adult.add(new THREE.Mesh(new THREE.TubeGeometry(gutCurve, 160, 0.052, 12), tissue("#d9772f", 0.8, { rim: 1.4, body: 0.2, grain: 1 })));
  const stomach = new THREE.Mesh(wobble(new THREE.SphereGeometry(0.21, 28, 20), 0.05), tissue("#a94f1f", 0.9, { rim: 1.3, body: 0.24, grain: 1, fibre: 0.8 }));
  stomach.position.set(-0.2, -1.08, 0.05);
  stomach.scale.set(1.15, 0.85, 0.8);
  adult.add(stomach);

  // Pale gonad beside the gut.
  const count = detail ? 90 : 0;
  if (count) {
    const gonad = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), tissue("#fff0d6", 0.5, { rim: 1, body: 0.18, grain: 0.4 }), count);
    const d = new THREE.Object3D();
    let seed = 41;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const a = r() * 6.28, h = r();
      d.position.set(0.12 + Math.cos(a) * 0.17 * r(), -1.14 + h * 0.44, -0.08 + Math.sin(a) * 0.17 * r());
      d.scale.setScalar(0.014 + r() * 0.016);
      d.updateMatrix();
      gonad.setMatrixAt(i, d.matrix);
    }
    adult.add(gonad);

    // Endostyle: the pale groove down the front of the basket.
    const endostyle = new THREE.CatmullRomCurve3([[-0.32, 1.3, 0.1], [-0.42, 0.55, 0.14], [-0.47, -0.15, 0.12], [-0.34, -0.62, 0.05]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    adult.add(new THREE.Mesh(new THREE.TubeGeometry(endostyle, 60, 0.011, 8), tissue("#f3f6dc", 0.42, { rim: 0.7, body: 0.45, grain: 0.3 })));
  }
  return adult;
}

/** Rock the colony grows on. It does not sway. */
export function buildRock(time: CionaUniforms, fade: { value: number }) {
  const tissue = tissueFactory(time, fade, 0, 0);
  const g = new THREE.SphereGeometry(1, 96, 48);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.09 * Math.sin(x * 5 + z * 3) + 0.05 * Math.sin(z * 11 + x * 7) + 0.03 * Math.sin(x * 23 + y * 13);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  const rock = new THREE.Mesh(g, tissue("#3d4a66", 0.42, { rim: 1.3, body: 0.09, grain: 1 }));
  rock.scale.set(3.4, 0.5, 1.9);
  return rock;
}

export function buildLarva(time: CionaUniforms, fade: { value: number }) {
  const tissue = tissueFactory(time, fade, 1);
  const larva = new THREE.Group();
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
  larva.add(new THREE.Mesh(body, tissue("#c9d8ea", 0.62, { rim: 2.4, body: 0.035, grain: 0.5, cell: 15 })));

  // Outer tunic: a clear, thin coat with almost no structure.
  const coat = shapeTrunk(toAxis(lathe([
    [-1.84, 0.002], [-1.74, 0.17], [-1.46, 0.33], [-1.08, 0.46], [-0.7, 0.49], [-0.36, 0.38], [-0.08, 0.21], [0.1, 0.16],
  ], 96)));
  coat.scale(1, 1, 0.82);
  larva.add(new THREE.Mesh(coat, tissue("#a9c2dd", 0.22, { rim: 3.6, body: 0, grain: 0.2 })));

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
  larva.add(new THREE.Mesh(fin, tissue("#b6cde6", 0.5, { rim: 1, body: 0.4, grain: 0.5, rays: 62 })));

  // Three adhesive palps: real, but only low domes on the snout, inside the clear coat.
  [[1.68, 0.03, 0], [1.65, -0.2, 0.1], [1.65, -0.2, -0.1]].forEach(([x, y, z]) => {
    const palp = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), tissue("#dce9fa", 0.34, { rim: 2.2, body: 0.05, grain: 0.3 }));
    palp.position.set(x, y, z);
    palp.scale.set(0.085, 0.05, 0.05);
    larva.add(palp);
  });

  // Sensory vesicle: a thin clear sac, not a ball.
  const vesicle = new THREE.Mesh(wobble(new THREE.SphereGeometry(0.2, 40, 28), 0.04), tissue("#9fd6e4", 0.4, { rim: 2.4, body: 0.02, grain: 0.3 }));
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
  otolith.renderOrder = 4;
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
  cup.renderOrder = 4;
  larva.add(cup);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), tissue("#dff0fa", 0.3, { rim: 1.6, body: 0.12, grain: 0 }));
  lens.position.set(0.95, 0.17, 0.03);
  larva.add(lens);

  // Endoderm and mesenchyme: many small pale cells, clustered in the back and belly of the trunk.
  const CELLS = 300;
  const endoderm = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), tissue("#e3d3ad", 0.28, { rim: 1.5, body: 0.05, grain: 0.3 }), CELLS);
  for (let i = 0; i < CELLS; i++) {
    const a = r() * 6.28, b = Math.acos(2 * r() - 1), rr = Math.cbrt(r());
    const inBelly = i % 3 > 0;
    d.position.set(
      (inBelly ? 0.56 : 0.72) + Math.sin(b) * Math.cos(a) * rr * (inBelly ? 0.36 : 0.5),
      (inBelly ? -0.13 : -0.16) + Math.cos(b) * rr * (inBelly ? 0.16 : 0.13),
      Math.sin(b) * Math.sin(a) * rr * 0.25,
    );
    d.scale.setScalar(inBelly ? 0.02 + r() * 0.018 : 0.012 + r() * 0.01);
    d.updateMatrix();
    endoderm.setMatrixAt(i, d.matrix);
  }
  larva.add(endoderm);

  // Notochord: exactly 40 thin stacked cells, as in the animal, inside a faint sheath.
  const noto = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), tissue("#f2ead7", 0.55, { rim: 1.9, body: 0.035, grain: 0.15 }), 40);
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
  larva.add(new THREE.Mesh(sheath, tissue("#d8e2ee", 0.25, { rim: 2.4, body: 0, grain: 0.1 })));

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
    larva.add(mesh);
    return material;
  });

  return { larva, muscles, pigments };
}
