// Fails when a change would break what is already committed on chain:
//   - the experiment's protocolHash (simulator, runner, connectome, protocol, lockfile)
//   - the Lab's rulesHash (Lab engine, runner, verifier, contract, rules)
// Run with `npm run check:locks`. CI runs it on every push and pull request.
// Files are read from the commit (git HEAD), byte for byte, so the answer is the same on every
// OS whatever line endings the working copy uses. Commit first, then check.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { keccak256, toHex } from "viem";

/** Values recorded on Elysium. They never change; a mismatch means the change must not ship. */
const EXPERIMENT_PROTOCOL_HASH = "0x00dee041adba5494dc69dbc09031534a0864485b6bd2263a3953279dc909d3a7";
const LAB_RULES_HASH = "0xf5582fafc1f6def0fd229d08acda6d37b9b4c4754a2798047a1be6f5d4276dfe";

const blob = (path: string) => execFileSync("git", ["show", `HEAD:${path}`], { maxBuffer: 1 << 28 });
const list = (dir: string, ext: string) =>
  execFileSync("git", ["ls-tree", "--name-only", "HEAD", `${dir}/`])
    .toString()
    .trim()
    .split("\n")
    .map((p) => p.slice(dir.length + 1))
    .filter((f) => f.endsWith(ext));

/** Same file order and bytes as runner/deploy.ts protocolHash(). */
function protocolHash(): string {
  const h = createHash("sha256");
  const add = (dir: string, files: string[]) => {
    for (const f of files.sort()) {
      h.update(f);
      h.update(blob(dir === "." ? f : `${dir}/${f}`));
    }
  };
  add("src", list("src", ".ts"));
  add("runner", list("runner", ".ts"));
  add("data/connectome", ["nodes.csv", "edges.csv"]);
  add("protocol", list("protocol", ".json"));
  add("runner/artifacts", list("runner/artifacts", ".json"));
  add(".", ["package-lock.json"]);
  return `0x${h.digest("hex")}`;
}

/** Same as lab/cli.ts rulesHash(), which normalises line endings itself. */
function rulesHash(): string {
  const files = ["lab/core.ts", "lab/runner.ts", "lab/verify.ts", "contracts/src/LabHabitat.sol", "lab/RULES.md"];
  return keccak256(toHex(files.map((f) => `${f}\n${blob(f).toString("utf8").replace(/\r\n/g, "\n")}`).join("\n")));
}

let ok = true;
for (const [name, got, want, what] of [
  ["Experiment protocolHash", protocolHash(), EXPERIMENT_PROTOCOL_HASH, "src/, runner/, data/connectome, protocol/, runner/artifacts, package-lock.json"],
  ["Lab rulesHash", rulesHash(), LAB_RULES_HASH, "lab/core.ts, lab/runner.ts, lab/verify.ts, contracts/src/LabHabitat.sol, lab/RULES.md"],
] as const) {
  if (got === want) console.log(`OK    ${name} ${got}`);
  else {
    ok = false;
    console.error(`FAIL  ${name}\n      on chain ${want}\n      here     ${got}\n      These files are locked: ${what}. Revert the change to them.`);
  }
}
if (!ok) process.exit(1);
