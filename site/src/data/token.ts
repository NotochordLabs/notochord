/**
 * Everything the $CHORD page states about the token. A null shows as not yet
 * published: nothing here may be filled with an estimate.
 */
export const TOKEN = {
  ticker: "$CHORD",
  /** The contract address. Set this once the token exists. */
  address: "0x6bd503be90d07dd4d917F885c007AfEE6e53b403" as string | null,
  /** The network the address is on. */
  network: "Elysium (chain ID 99901)" as string | null,
  /** Link to the address on that network's explorer. */
  explorerUrl: null as string | null,
};
