/** Build a `/transactions?...` deep link — used by Dashboard/Budget elements
 * (a calendar day, a trend bar, a credit card, a category/group row) to jump
 * straight to a pre-filtered Transactions view. */
export function transactionsLink(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `/transactions?${s}` : "/transactions";
}
