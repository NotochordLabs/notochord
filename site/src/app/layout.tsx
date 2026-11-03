import type { Metadata } from "next";
import "@fontsource-variable/hanken-grotesk/index.css";
import "@fontsource-variable/source-serif-4/index.css";
import "./globals.css";
import Shell from "@/components/Shell";

const description = "Artificial brains carrying the mapped wiring of a Ciona larva, evolved by natural selection against the market. A public experiment. It manages no funds and promises no returns.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.notochord.live"),
  title: { default: "Notochord: Experiment 177", template: "%s · Notochord" },
  description,
  openGraph: { type: "website", siteName: "Notochord", title: "Can a Ciona brain learn the market?", description, url: "/", images: [{ url: "/og.png", width: 1200, height: 630, alt: "The wiring of a Ciona larva, shown as glowing cells and connections" }] },
  twitter: { card: "summary_large_image", title: "Can a Ciona brain learn the market?", description, images: ["/og.png"] },
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
