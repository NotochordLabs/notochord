"use client";

import { useState } from "react";

export default function TokenAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="tokenAddress">
      <code>{address}</code>
      <button onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
    </div>
  );
}
