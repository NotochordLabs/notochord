import type { Connectome } from "./connectome";

/**
 * Which cells receive market input and which cells read out the decision.
 *
 * Protocol mapping: gravity sensors (otolith / antenna cells) feel the price
 * direction, light sensors (ocellus photoreceptors) feel the change in volume,
 * and the left vs right motor neurons decide sell vs buy.
 *
 * The cell names in the real dataset have not been checked yet, so detection
 * first tries name patterns and, for any role it cannot fill, falls back to
 * graph structure (sources with no inputs, sinks with no outputs). The CLI
 * prints the chosen cells so the mapping can be verified against the paper.
 */
export interface Roles {
  priceUp: number[];
  priceDown: number[];
  volume: number[];
  motorL: number[];
  motorR: number[];
  method: { price: "names" | "degree"; volume: "names" | "degree"; motor: "names" | "degree" };
}

const GRAVITY = /otolith|(^|[^a-z])oto|^ant(\d|[^a-z]|$)|antenna/i;
const LIGHT = /photo|ocell|(^|[^a-z])pr(\d|[^a-z]|$)/i;
const MOTOR = /(^|[^a-z])mn(\d|[^a-z]|$)|motor/i;

function side(name: string): "L" | "R" | null {
  if (/left/i.test(name) || /L\d*$/.test(name)) return "L";
  if (/right/i.test(name) || /R\d*$/.test(name)) return "R";
  return null;
}

function splitBySide(ids: number[], names: string[]): [number[], number[]] {
  const l = ids.filter((i) => side(names[i]) === "L");
  const r = ids.filter((i) => side(names[i]) === "R");
  if (l.length > 0 && r.length > 0) return [l, r];
  const half = Math.ceil(ids.length / 2);
  return [ids.slice(0, half), ids.slice(half)];
}

export function detectRoles(c: Connectome): Roles {
  const inDeg = new Int32Array(c.n);
  const outDeg = new Int32Array(c.n);
  for (let e = 0; e < c.edgeSrc.length; e++) {
    outDeg[c.edgeSrc[e]]++;
    inDeg[c.edgeDst[e]]++;
  }
  const all = Array.from({ length: c.n }, (_, i) => i);
  const used = new Set<number>();
  const take = (ids: number[]) => {
    ids.forEach((i) => used.add(i));
    return ids;
  };

  // Motor first: it needs both sides.
  let motorL: number[] = [];
  let motorR: number[] = [];
  let motorMethod: "names" | "degree" = "names";
  const motorNamed = all.filter((i) => MOTOR.test(c.names[i]));
  const ml = motorNamed.filter((i) => side(c.names[i]) === "L");
  const mr = motorNamed.filter((i) => side(c.names[i]) === "R");
  if (ml.length > 0 && mr.length > 0) {
    motorL = take(ml);
    motorR = take(mr);
  } else {
    motorMethod = "degree";
    const sinks = all
      .filter((i) => inDeg[i] > 0)
      .sort((a, b) => outDeg[a] - outDeg[b] || inDeg[b] - inDeg[a] || a - b)
      .slice(0, 8);
    motorL = take(sinks.filter((_, k) => k % 2 === 0));
    motorR = take(sinks.filter((_, k) => k % 2 === 1));
  }

  let priceUp: number[];
  let priceDown: number[];
  let priceMethod: "names" | "degree" = "names";
  const gravity = all.filter((i) => !used.has(i) && GRAVITY.test(c.names[i]));
  if (gravity.length >= 2) {
    [priceUp, priceDown] = splitBySide(gravity, c.names);
    take(gravity);
  } else {
    priceMethod = "degree";
    const sources = all
      .filter((i) => !used.has(i) && outDeg[i] > 0)
      .sort((a, b) => inDeg[a] - inDeg[b] || outDeg[b] - outDeg[a] || a - b)
      .slice(0, 4);
    priceUp = take(sources.slice(0, 2));
    priceDown = take(sources.slice(2, 4));
  }

  let volume: number[];
  let volumeMethod: "names" | "degree" = "names";
  const light = all.filter((i) => !used.has(i) && LIGHT.test(c.names[i]));
  if (light.length >= 1) {
    volume = take(light);
  } else {
    volumeMethod = "degree";
    volume = take(
      all
        .filter((i) => !used.has(i) && outDeg[i] > 0)
        .sort((a, b) => inDeg[a] - inDeg[b] || outDeg[b] - outDeg[a] || a - b)
        .slice(0, 2),
    );
  }

  return {
    priceUp,
    priceDown,
    volume,
    motorL,
    motorR,
    method: { price: priceMethod, volume: volumeMethod, motor: motorMethod },
  };
}
