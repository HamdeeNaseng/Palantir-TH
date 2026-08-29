"use client";

import { Section, SectionAction, toggle } from "@/components/filters/FilterSection";
import { EVENT_COLOR } from "@/lib/palette";
import { EVENT_FAMILY_LABEL, EVENT_TYPE_LABEL } from "@/lib/labels";
import { EVENT_FAMILY_ICON, EVENT_ICON } from "@/lib/event-icons";
import { EVENT_FAMILIES, typesInFamily } from "@/lib/types";
import type { EventType } from "@/lib/types";

/**
 * The "ประเภทเหตุ" filter, in one place for every page that offers it.
 *
 * `/events` used to draw its own flat chip row straight off the server facets,
 * so the same filter looked and behaved differently depending on which tab you
 * were standing on: no family grouping, and — because a facet only exists for
 * a type some event actually carries — types silently disappeared from the
 * list as you narrowed the view, which reads as the vocabulary changing rather
 * than the data thinning out.
 *
 * The list here is always the full vocabulary, grouped by family, exactly as
 * `/investigate` shows it. Counts stay optional: pass `counts` and each chip
 * reports how many events it would match (0 included, which is the honest
 * answer for a type nothing in the current window carries); omit it and the
 * chips are plain, as on `/investigate`, where no facet counts are computed.
 */

const EVENT_TYPE_GROUPS = EVENT_FAMILIES.map((family) => ({
  family,
  label: EVENT_FAMILY_LABEL[family],
  Icon: EVENT_FAMILY_ICON[family],
  types: typesInFamily(family),
}));

/** Facet rows (`{ value, n }`) folded into the `counts` map this takes. */
export function countsByType(
  facets: readonly { value: EventType; n: number }[],
): Partial<Record<EventType, number>> {
  return Object.fromEntries(facets.map((f) => [f.value, f.n]));
}

export default function EventTypeFilter({
  selected,
  onChange,
  counts,
  title = "ประเภทเหตุ",
}: {
  selected: EventType[];
  onChange: (next: EventType[]) => void;
  /** Per-type match counts, when the page has facets for them. */
  counts?: Partial<Record<EventType, number>>;
  title?: string;
}) {
  return (
    <Section
      title={title}
      // An empty selection *is* "everything", which is why clearing is what
      // the "select all" button does.
      action={<SectionAction onClick={() => onChange([])}>เลือกทั้งหมด</SectionAction>}
    >
      <div className="flex flex-wrap gap-1.5">
        {EVENT_TYPE_GROUPS.map((g) => (
          <div key={g.family} className="w-full">
            <p className="mt-1 mb-1 flex items-center gap-1 text-[10px] text-ink-muted first:mt-0">
              <g.Icon size={11} strokeWidth={2} className="shrink-0" aria-hidden />
              {g.label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {g.types.map((t) => {
                const on = selected.includes(t);
                const color = EVENT_COLOR[t];
                const Icon = EVENT_ICON[t];
                // A type with no facet row matched nothing — that is a 0, not
                // a missing number, so the chip row never goes ragged.
                const n = counts ? (counts[t] ?? 0) : undefined;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange(toggle<EventType>(selected, t))}
                    className="chip min-h-9 px-3 text-[12.5px] lg:min-h-0 lg:px-2 lg:text-[11px]"
                    style={{
                      color,
                      borderColor: on ? color : `${color}55`,
                      background: on ? `${color}26` : "transparent",
                    }}
                  >
                    <Icon size={12} strokeWidth={2} className="shrink-0" aria-hidden />
                    {EVENT_TYPE_LABEL[t]}
                    {n !== undefined && (
                      <span className="num opacity-70">{n.toLocaleString("en-US")}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
