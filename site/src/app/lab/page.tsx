import type { Metadata } from "next";
import Lab from "@/components/Lab";

export const metadata: Metadata = {
  title: "The Lab",
  description: "Breed new brains from Experiment 177's fossils by burning $CHORD. Each child races one day of live HYPE. Separate from the experiment, and checkable by anyone.",
};

export default function Page() {
  return <Lab />;
}
