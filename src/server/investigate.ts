import { DEFAULT_FILTERS, type InvestigationFilters } from "@/lib/filters";
import { thaiShortDate } from "@/lib/stats";
import { EVENT_TYPE_LABEL } from "@/lib/labels";
import {
  buildInvestigationDashboard,
  type CitizenSignal,
  type EventRow,
  type InvestigationDashboard,
  type KpiCard,
  type NetworkNode,
  type SourceReliabilityRow,
  type TrendSeries,
} from "@/lib/view-models/investigate";
import { getSnapshot } from "./snapshot";
import type { Snapshot } from "@/lib/snapshot";

/**
 * `/investigate`'s first paint.
 *
 * Every builder that used to live here — KPIs, trend, network, citizen signal,
 * recent events, the active case — is now in `@/lib/view-models/investigate`,
 * where the browser can run it too. See the note in `./events`.
 */
export async function getInvestigationDashboard(
  filters: InvestigationFilters = DEFAULT_FILTERS,
): Promise<{ data: InvestigationDashboard; snapshotVersion: Snapshot["version"] }> {
  const snapshot = await getSnapshot();
  return {
    data: buildInvestigationDashboard(snapshot, filters, Date.now()),
    snapshotVersion: snapshot.version,
  };
}

export { EVENT_TYPE_LABEL, thaiShortDate, DEFAULT_FILTERS };
export type { InvestigationFilters };
export type {
  CitizenSignal,
  EventRow,
  InvestigationDashboard,
  KpiCard,
  NetworkNode,
  SourceReliabilityRow,
  TrendSeries,
};
export type { EventFeature, EventFeatureCollection } from "./shared-events";
