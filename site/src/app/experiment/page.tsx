import type { Metadata } from "next";
import LiveExperiment from "@/components/LiveExperiment";

export const metadata: Metadata = {
  title: "Live experiment",
  description: "Experiment 177 as it runs on Elysium: generations, hourly decisions and transactions, read from the chain.",
};

export default function Page() {
  return (
    <article className="testRun">
      <header>
        <h1>Experiment 177, live</h1>
        <p>Read from Elysium as you watch, on paper trades only. A running experiment is not a result: the test comes after 100 generations and 28 unseen days.</p>
      </header>
      <LiveExperiment />
    </article>
  );
}
