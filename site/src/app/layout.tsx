import type { Metadata } from "next";
import "@fontsource-variable/hanken-grotesk/index.css";
import "@fontsource-variable/source-serif-4/index.css";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "Notochord: Experiment 177",
  description: "Artificial brains built on the real wiring diagram of a Ciona larva, evolved by natural selection against a live market question.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
