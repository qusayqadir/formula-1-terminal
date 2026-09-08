import { mixHex } from "@/lib/colors";

/** Resolves the display colour for one side of an A/B comparison. Normally
 *  that's just each driver's own identity colour — but when A and B are
 *  team-mates, they share the EXACT same hex, and an overlaid line/dot
 *  chart renders as one line rather than two. Rather than inventing a new
 *  competing colour, B gets lightened 50% toward white in that case: still
 *  reads as "same team", but no longer indistinguishable from A. */
export function compareColor(
  slot: "a" | "b",
  driverA: { teamId: number; color: string },
  driverB: { teamId: number; color: string },
): string {
  const row = slot === "a" ? driverA : driverB;
  if (slot === "a" || driverA.teamId !== driverB.teamId) return row.color;
  return mixHex(row.color, "#ffffff", 0.5);
}
