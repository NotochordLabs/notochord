import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const PATHS = ["", "selection", "population", "genome", "lineage", "fossils", "ledger", "cells", "report", "protocol", "verify"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((p) => ({ url: `https://www.notochord.live/${p ? `${p}/` : ""}` }));
}
