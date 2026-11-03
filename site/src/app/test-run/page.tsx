import type { Metadata } from "next";
import Link from "next/link";
import TestRun from "@/components/TestRun";

export const metadata: Metadata = {
  title: "Test run",
  description: "A short test deployment of the Notochord contracts on Elysium, read live from the chain. It is not the experiment.",
};

export default function Page() {
  return (
    <article className="testRun">
      <header>
        <p className="testTag">Test run, not the experiment</p>
        <h1>Live on Elysium, as a rehearsal</h1>
        <p>A short test of the contracts and the runner: two generations, read from the chain as you watch. It checks that the machinery works. It says nothing about whether the brains can learn, and its numbers will never count as a result. <Link href="/how/">How it works</Link>.</p>
      </header>
      <TestRun />
    </article>
  );
}
