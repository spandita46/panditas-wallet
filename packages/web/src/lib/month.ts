export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
export function monthLabel(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString("en-CA", { month: "long", year: "numeric" });
}
export function shiftMonth(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setMonth(d.getMonth() + delta);
  return monthKey(d);
}

/** Last calendar day of the month, as "YYYY-MM-DD" (unlike monthKey, which always fixes day 01). */
export function monthEndDate(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
