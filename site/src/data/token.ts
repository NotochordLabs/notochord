/**
 * Everything the $CHORD page states about the token. A null shows as not yet
 * published: nothing here may be filled with an estimate.
 */
export const TOKEN = {
  ticker: "$CHORD",
  /** The contract address. Set this once the token exists. */
  address: null as string | null,
  /** The network the address is on. */
  network: null as string | null,
  /** Link to the address on that network's explorer. */
  explorerUrl: null as string | null,
  totalSupply: null as string | null,
  teamShare: null as string | null,
  liquidity: null as string | null,
};
