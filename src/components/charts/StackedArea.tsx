interface Series {
  key: string;
  label: string;
  color: string;
  points: number[];
}

/**
 * Stacked area chart for the 30-day event-type trend. Renders its own axes so
 * the panel stays a single self-contained SVG.
 */
export default function StackedArea({
  series,
  labels,
  max,
  height = 150,
}: {
  series: Series[];
  labels: string[];
  max: number;
  height?: number;
}) {
  const W = 560;
  const H = height;
  const padL = 26;
  const padB = 18;
  const padT = 6;
  const plotW = W - padL - 6;
  const plotH = H - padB - padT;
  const n = labels.length;
  const step = plotW / (n - 1);

  const x = (i: number) => padL + i * step;
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  // Walk the series bottom-up, keeping a running total per column.
  const running = new Array(n).fill(0);
  const bands = series.map((s) => {
    const lower = [...running];
    const upper = running.map((base, i) => base + s.points[i]);
    for (let i = 0; i < n; i++) running[i] = upper[i];

    const top = upper.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const bottom = lower
      .map((v, i) => `L${x(n - 1 - i).toFixed(1)},${y(lower[n - 1 - i]).toFixed(1)}`)
      .join(" ");
    return { ...s, area: `${top} ${bottom} Z`, line: top };
  });

  const gridValues = [0, max / 3, (max * 2) / 3, max].map((v) => Math.round(v));
  // Six evenly spaced ticks keeps the Thai date labels from colliding.
  const tickEvery = Math.max(1, Math.floor((n - 1) / 5));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="แนวโน้มเหตุการณ์ 30 วัน">
      {gridValues.map((v) => (
        <g key={v}>
          <line
            x1={padL}
            x2={W - 6}
            y1={y(v)}
            y2={y(v)}
            stroke="rgba(56,100,150,0.18)"
            strokeWidth="1"
          />
          <text x={padL - 6} y={y(v) + 3.5} textAnchor="end" fontSize="9" fill="#64809f">
            {v}
          </text>
        </g>
      ))}

      {bands.map((b) => (
        <path key={b.key} d={b.area} fill={b.color} fillOpacity="0.28" />
      ))}
      {bands.map((b) => (
        <path key={`${b.key}-l`} d={b.line} fill="none" stroke={b.color} strokeWidth="1.3" />
      ))}

      {labels.map((label, i) =>
        i % tickEvery === 0 || i === n - 1 ? (
          <text key={label + i} x={x(i)} y={H - 5} textAnchor="middle" fontSize="9" fill="#64809f">
            {label}
          </text>
        ) : null,
      )}
    </svg>
  );
}
