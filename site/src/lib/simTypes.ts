/** Shapes the copied simulator engine (brain.ts) needs in the browser. */
export interface Connectome {
  n: number;
  rowPtr: Int32Array;
  edgeSrc: Int32Array;
  edgeDst: Int32Array;
  edgeBase: Int32Array;
}
export interface Roles {
  priceUp: number[];
  priceDown: number[];
  volume: number[];
  motorL: number[];
  motorR: number[];
}
export interface Layout {
  edges: number;
  neurons: number;
  size: number;
}
