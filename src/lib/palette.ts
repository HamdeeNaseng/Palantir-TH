import type { EventType, VerificationStatus } from "./types";

/** One colour per event type, shared by the map, legend, chips and tables. */
export const EVENT_COLOR: Record<EventType, string> = {
  unrest: "#ef4444",
  shooting: "#f97316",
  explosion: "#d946ef",
  arson: "#3b82f6",
  abduction: "#22d3ee",
  raid: "#22c55e",
  narcotics: "#a855f7",
  crime: "#f59e0b",
  gang: "#eab308",
  other: "#94a3b8",
};

export const SEVERITY_COLOR: Record<number, string> = {
  1: "#22c55e",
  2: "#84cc16",
  3: "#f59e0b",
  4: "#f97316",
  5: "#ef4444",
};

export const VERIFICATION_COLOR: Record<VerificationStatus, string> = {
  verified: "#22c55e",
  under_review: "#f59e0b",
  unverifiable: "#64809f",
};
