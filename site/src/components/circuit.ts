import * as THREE from "three";
import data from "@/data/experiment.json";

const cells = data.brain.cells;
const edges = data.brain.edges;
export const CURVE_STEPS = 6;

/**
 * Lays the real wiring out as a circuit: input on the left, motor neurons on the
 * right, everything else by how many connections it sits from sensory input.
 * Connections and spikes are the data; positions are our arrangement, not anatomy.
 */
export function circuitLayout(): THREE.Vector3[] {
  const motor = (r: string) => r === "motorL" || r === "motorR";
  const depths = [...new Set(cells.filter((c) => !motor(c.role)).map((c) => c.z))].sort((a, b) => a - b);
  const column = new Map(depths.map((z, i) => [z, i]));
  const columns = depths.length;
  const pos = cells.map(() => new THREE.Vector3());

  // Order each column by where its inputs sit, which keeps long crossings down.
  const yGuess = cells.map((c) => c.y);
  const inputs: number[][] = cells.map(() => []);
  for (let e = 0; e < edges.length; e += 2) inputs[edges[e + 1]].push(edges[e]);

  for (const z of depths) {
    const members = cells.flatMap((c, i) => (c.z === z && !motor(c.role) ? [i] : []));
    const score = (i: number) => (inputs[i].length ? inputs[i].reduce((a, s) => a + yGuess[s], 0) / inputs[i].length : yGuess[i]);
    members.sort((a, b) => score(b) - score(a) || a - b);
    const x = -1 + (1.62 * column.get(z)!) / Math.max(1, columns - 1);
    const radius = 0.16 + 0.56 * Math.sqrt(members.length / cells.length) * 1.5;
    members.forEach((c, k) => {
      // A flattened disc: sorted top to bottom, spread front to back by the golden angle.
      const t = (k + 0.5) / members.length;
      const y = (0.5 - t) * 2 * radius;
      const span = Math.sqrt(Math.max(0, radius * radius - y * y));
      const a = k * 2.399963;
      pos[c].set(x + Math.cos(a) * 0.055, y, Math.sin(a) * span * 0.8);
      yGuess[c] = y;
    });
  }

  // Two opposing motor columns: left motor neurons above, right below.
  for (const [role, sign] of [["motorL", 1], ["motorR", -1]] as const) {
    const members = cells.flatMap((c, i) => (c.role === role ? [i] : []));
    members.forEach((c, k) => {
      const t = members.length > 1 ? k / (members.length - 1) : 0.5;
      pos[c].set(1.02, sign * (0.28 + t * 0.34), (t - 0.5) * 0.3);
    });
  }
  return pos;
}

/** A nerve fibre: leaves and arrives roughly horizontally, like an axon in a tract. */
export function fibrePoint(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  const handle = Math.max(0.1, Math.abs(b.x - a.x) * 0.5);
  const u = 1 - t;
  const c1x = a.x + handle, c2x = b.x - handle;
  out.set(
    u * u * u * a.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * b.x,
    u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * b.y,
    u * u * u * a.z + 3 * u * u * t * a.z + 3 * u * t * t * b.z + t * t * t * b.z,
  );
  return out;
}
