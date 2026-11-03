/** Where does the sensory signal die? Wiring facts and layer-by-layer firing in random genomes. Training hours only. */
import { readFileSync } from "node:fs";
import { express, Scratch, think } from "../src/brain";
import { loadConnectome } from "../src/connectome";
import { DEFAULTS } from "../src/experiment";
import { layoutFor } from "../src/genome";
import { loadMarket } from "../src/market";
import { detectRoles } from "../src/roles";
const seed = "experiment-177-001";
const c = loadConnectome("data/connectome"), m = loadMarket("data/prices-HYPE-1h.json"), roles = detectRoles(c), layout = layoutFor(c), sc = new Scratch(c.n);
console.log("method", roles.method);
const nm = (a: number[]) => a.map((i) => c.names[i]).join(",");
for (const k of ["priceUp","priceDown","volume","motorL","motorR"] as const) console.log(k, roles[k].length, nm(roles[k]));
const b = Array.from(c.edgeBase).sort((x, y) => x - y), q = (a: number[], p: number) => a[Math.floor(p * (a.length - 1))];
console.log("edgeBase min/med/p90/max", b[0], q(b,.5), q(b,.9), b[b.length-1]);
const inW = new Float64Array(c.n), inD = new Int32Array(c.n);
for (let e = 0; e < c.edgeSrc.length; e++) { inW[c.edgeDst[e]] += c.edgeBase[e]; inD[c.edgeDst[e]]++; }
const iw = Array.from(inW).sort((x, y) => x - y);
console.log("total inward base per cell med/p90/max", q(iw,.5), q(iw,.9), iw[iw.length-1], "threshold range 48..1068, median about 558");
function bfs(src: number[]) { const d = new Int32Array(c.n).fill(-1); let f = src; f.forEach(i => d[i]=0); let l=0; while(f.length){l++;const nx:number[]=[];for(const i of f)for(let e=c.rowPtr[i];e<c.rowPtr[i+1];e++){const j=c.edgeDst[e];if(d[j]<0){d[j]=l;nx.push(j);}}f=nx;}return d; }
for (const [k,s] of [["price",[...roles.priceUp,...roles.priceDown]],["volume",roles.volume]] as const) { const d=bfs(s as number[]); console.log(k,"reach",Array.from(d).filter(x=>x>=0).length,"of",c.n,"dist to motorL",roles.motorL.map(i=>d[i]).join(","),"motorR",roles.motorR.map(i=>d[i]).join(",")); }
const P=new Set([...roles.priceUp,...roles.priceDown]), V=new Set(roles.volume);
let dp=0,dv=0;const M=new Set([...roles.motorL,...roles.motorR]);
const motorIn=[...M].map(i=>inW[i]);console.log("motor inward base",motorIn.join(","));
for(let e=0;e<c.edgeSrc.length;e++){if(M.has(c.edgeDst[e])){if(P.has(c.edgeSrc[e]))dp++;if(V.has(c.edgeSrc[e]))dv++;}}console.log("direct edges to motor: price",dp,"volume",dv);
const gs:Uint8Array[]=[];for(let k=1;k<=6;k++){const f=JSON.parse(readFileSync(`out/${seed}/r${k}/fossils/gen-000.json`,"utf8"));for(const r of f.selection.slice(0,16))gs.push(Uint8Array.from(Buffer.from(r.genome,"hex")));}
const ds=[bfs([...roles.priceUp,...roles.priceDown]),bfs(roles.volume)];
for(const [lab,s,di] of [["strong price only",{r1:80,r4:80,dv:0},0],["volume only",{r1:0,r4:0,dv:4000},1]] as const){const cnt=new Map<number,[number,number]>();
 for(const g of gs){const br=express(c,layout,g);const ever=new Uint8Array(c.n);think(c,roles,br,s,sc,(sp)=>{for(let i=0;i<c.n;i++)if(sp[i])ever[i]=1;});for(let i=0;i<c.n;i++){const l=ds[di as number][i];if(l<0)continue;const x=cnt.get(l)??[0,0];x[0]++;x[1]+=ever[i];cnt.set(l,x);}}
 console.log(lab,"fraction firing by synaptic distance:",[...cnt.entries()].sort((a,b)=>a[0]-b[0]).map(([l,[n,f]])=>`${l}:${(100*f/n).toFixed(0)}%`).join(" "));}
