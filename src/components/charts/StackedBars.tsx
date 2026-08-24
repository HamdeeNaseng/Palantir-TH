/** Stacked daily bars broken down by reporting channel. */
export default function StackedBars({
  channels,
  height = 118,
}: {
  channels: { key: string; label: string; color: string; series: number[] }[];
  height?: number;
}) {
  const W = 300;
  const H = height;
  const padL = 26;
  const padB = 12;
  const padT = 6;
  const plotW = W - padL - 6;
  const plotH = H - padB - padT;
  const n = channels[0]?.series.length ?? 0;
  if (!n) return null;

  const totals = Array.from({ length: n }, (_, i) =>
    channels.reduce((s, c) => s + c.series[i], 0),
  );
  // Real ingestion can legitimately produce an all-zero series. Keep a
  // non-zero scale so SVG coordinates never become NaN in that empty state.
  const max = Math.max(1, Math.max(...totals) * 1.05);
  const bw = (plotW / n) * 0.72;
  const gap = plotW / n;

  const grid = [0, 500, 1000, 1500, 2000].filter((v) => v <= max);
  const gridTicks = [
    ...new Set(grid.length > 1 ? grid : [0, Math.round(max / 2), Math.round(max)]),
  ];
  const yFor = (v: number) => padT + plotH - (v / max) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="สัดส่วนแหล่งข่าวไม่ทางการ">
      {gridTicks.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - 6} y1={yFor(v)} y2={yFor(v)} stroke="rgba(56,100,150,0.14)" />
          <text x={padL - 5} y={yFor(v) + 3} textAnchor="end" fontSize="8" fill="#64809f">
            {v >= 1000 ? `${v / 1000}K` : v}
          </text>
        </g>
      ))}

      {Array.from({ length: n }, (_, i) => {
        let cursor = 0;
        return (
          <g key={i}>
            {channels.map((c) => {
              const v = c.series[i];
              const h = (v / max) * plotH;
              const yTop = padT + plotH - (cursor / max) * plotH - h;
              cursor += v;
              return (
                <rect
                  key={c.key}
                  x={padL + i * gap + (gap - bw) / 2}
                  y={yTop}
                  width={bw}
                  height={Math.max(0, h)}
                  fill={c.color}
                  fillOpacity="0.9"
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
