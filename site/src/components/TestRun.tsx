"use client";

import { useEffect, useState } from "react";

interface Config { name: string; rpc: string; chainId: number; generation: string; fossil: string; verifier: string; generations: number; holdoutHours: number; hoursPerGeneration: number; population: number }
interface ThoughtRow { generation: number; hour: number; buy: number; sell: number; hold: number; tx: string; block: number }
interface View { phase: number; generation: number; hours: number; block: number; thoughts: ThoughtRow[]; closed: number; lastSeen: number | null }

const THOUGHT = "0x95c0e7f744cdc36d102d648a282d8edd370c98acffde513efb3f31b19fc5149a";
const CLOSED = "0x3476406ff7f5297ca8681ee4b1bb874878c172dcedba3e71f7b5463395aa7932";
/** About 40 blocks a minute: this reaches back well over a day. */
const LOOKBACK = 80_000;
const PHASES = ["Waiting to commit", "Waiting for the first brains", "Between generations", "Generation running", "Finished"];

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error || j.result === undefined) throw new Error(j.error?.message ?? "no result");
  return j.result;
}

/** Reads one ABI-encoded `bytes` value out of a log's data. */
function bytesAt(data: string, slot: number): Uint8Array {
  const word = (i: number) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
  const offset = Number(BigInt(`0x${word(slot)}`)) / 32;
  const size = Number(BigInt(`0x${word(offset)}`));
  const hex = data.slice(2 + (offset + 1) * 64, 2 + (offset + 1) * 64 + size * 2);
  return Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
}

async function read(c: Config): Promise<View> {
  const call = async (data: string) => Number(BigInt(await rpc<string>(c.rpc, "eth_call", [{ to: c.generation, data }, "latest"])));
  const id = Number(BigInt(await rpc<string>(c.rpc, "eth_chainId", [])));
  if (id !== c.chainId) throw new Error("wrong chain");
  const [phase, generation, hours, block] = await Promise.all([call("0xb1c9fe6e"), call("0x17219522"), call("0x3d6ec6bd"), rpc<string>(c.rpc, "eth_blockNumber", []).then((b) => Number(BigInt(b)))]);
  const fromBlock = `0x${Math.max(0, block - LOOKBACK).toString(16)}`;
  // Some RPCs refuse wide log queries. The state above still stands without them.
  const logs = await rpc<{ topics: string[]; data: string; transactionHash: string; blockNumber: string }[]>(c.rpc, "eth_getLogs", [{ address: c.generation, fromBlock, toBlock: "latest", topics: [[THOUGHT, CLOSED]] }]).catch(() => []);
  const thoughts = logs.filter((l) => l.topics[0] === THOUGHT).map((l) => {
    const d = bytesAt(l.data, 1);
    const count = (v: number) => d.reduce((n, x) => n + (x === v ? 1 : 0), 0);
    return { generation: Number(BigInt(l.topics[1])), hour: Number(BigInt(l.topics[2])), buy: count(1), sell: count(2), hold: count(0), tx: l.transactionHash, block: Number(BigInt(l.blockNumber)) };
  }).reverse();
  const last = logs.at(-1);
  let lastSeen: number | null = null;
  if (last) lastSeen = Number(BigInt((await rpc<{ timestamp: string }>(c.rpc, "eth_getBlockByNumber", [last.blockNumber, false])).timestamp)) * 1000;
  return { phase, generation, hours, block, thoughts, closed: logs.length - thoughts.length, lastSeen };
}

const short = (x: string) => `${x.slice(0, 8)}…${x.slice(-6)}`;

export default function TestRun() {
  const [config, setConfig] = useState<Config | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    fetch("/live/test-run.json").then((r) => r.json() as Promise<Config>).then((c) => {
      if (stop) return;
      setConfig(c);
      const go = () => read(c).then((v) => { if (!stop) { setView(v); setFailed(false); } }).catch(() => { if (!stop) setFailed(true); });
      go();
      timer = setInterval(go, 60_000);
    }).catch(() => { if (!stop) setFailed(true); });
    return () => { stop = true; if (timer) clearInterval(timer); };
  }, []);

  if (failed && !view) return <div className="testState"><strong>Elysium did not answer</strong><p>This browser could not read the chain, so nothing is shown here. Nothing on this page is ever filled in from a simulation. It tries again each minute.</p></div>;
  if (!config || !view) return <div className="testState"><strong>Reading the chain…</strong></div>;

  const total = config.generations * config.hoursPerGeneration;
  const done = Math.min(total, view.generation * config.hoursPerGeneration + (view.phase === 3 ? view.hours : 0));
  return (
    <>
      <div className="testNumbers">
        <div><span>State</span><b>{PHASES[view.phase] ?? "Unknown"}</b></div>
        <div><span>Generation</span><b>{Math.min(view.generation + 1, config.generations)} of {config.generations}</b></div>
        <div><span>Hours on chain</span><b>{done} of {total}</b></div>
        <div><span>Last write</span><b>{view.lastSeen ? `${new Date(view.lastSeen).toISOString().slice(11, 16)} UTC` : "None yet"}</b></div>
      </div>
      <div className="testBar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Hours recorded on chain"><i style={{ width: `${(done / total) * 100}%` }} /></div>
      {failed && <p className="testNote">The last read failed. These numbers may be a minute or more old.</p>}

      <h2>Latest thoughts</h2>
      <p className="testNote">Each row is one transaction: all {config.population} brains deciding on one hour of HYPE. Paper trades only.</p>
      {view.thoughts.length === 0 ? <p className="testNote">None to show from the recent blocks.</p> : (
        <div className="tableWrap">
          <table>
            <thead><tr><th>Generation</th><th className="num">Hour</th><th className="num">Buy</th><th className="num">Sell</th><th className="num">Hold</th><th>Transaction</th></tr></thead>
            <tbody>
              {view.thoughts.slice(0, 8).map((t) => (
                <tr key={t.tx}><td>{t.generation + 1}</td><td className="num">{t.hour + 1}</td><td className="num">{t.buy}</td><td className="num">{t.sell}</td><td className="num">{t.hold}</td><td><code title={t.tx}>{short(t.tx)}</code></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Contracts</h2>
      <dl className="testContracts">
        <div><dt>Generation</dt><dd><code>{config.generation}</code></dd></div>
        <div><dt>Fossil</dt><dd><code>{config.fossil}</code></dd></div>
        <div><dt>ThoughtVerifier</dt><dd><code>{config.verifier}</code></dd></div>
      </dl>
      <p className="testNote">Chain ID {config.chainId}. Read directly from Elysium at block {view.block.toLocaleString("en-US")}.</p>
    </>
  );
}
