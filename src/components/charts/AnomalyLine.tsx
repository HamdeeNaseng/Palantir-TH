/**
 * Daily citizen-report volume against its 30-day mean, with the anomalous days
 * boxed in red — the "พุ่งสูงผิดปกติ" callout from the mockup.
 */
export default function AnomalyLine({
  daily,
  average,
  anomalyIndex,
  labels,
  height = 132,
}: {
  daily: number[];
  average: number[];
  anomalyIndex: number[];
  labels: string[];
  height?: number;
}) {
  const W = 420;
  const H = height;
  const padL = 30;
  const padB = 18;
  const padT = 14;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const n = daily.length;
  const step = plotW / (n - 1);
  const max = Math.max(...daily, ...average) * 1.12;

  const x = (i: number) => padL + i * step;
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  const path = (xs: number[]) =>
    xs.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const grid = [0, max / 4, max / 2, (max * 3) / 4, max].map((v) => Math.round(v / 50) * 50);
  const tickEvery = Math.max(1, Math.floor((n - 1) / 5));

  const anomalyStart = anomalyIndex.length ? Math.min(...anomalyIndex) : null;
  const anomalyEnd = anomalyIndex.length ? Math.max(...anomalyIndex) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="แนวโน้มรายวัน 30 วัน">
      {[...new Set(grid)].map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - 8} y1={y(v)} y2={y(v)} stroke="rgba(56,100,150,0.16)" />
          <text x={padL - 5} y={y(v) + 3.5} textAnchor="end" fontSize="8.5" fill="#64809f">
            {v}
          </text>
        </g>
      ))}

      {anomalyStart !== null && anomalyEnd !== null && (
        <>
          <rect
            x={x(anomalyStart) - step / 2}
            y={padT}
            width={(anomalyEnd - anomalyStart + 1) * step}
            height={plotH}
            fill="rgba(239,68,68,0.16)"
            stroke="rgba(239,68,68,0.55)"
            strokeWidth="1"
          />
          <text
            x={x(anomalyStart) + ((anomalyEnd - anomalyStart) * step) / 2}
            y={padT - 4}
            textAnchor="middle"
            fontSize="9"
            fill="#f87171"
            fontWeight="600"
          >
            พุ่งสูงผิดปกติ
          </text>
        </>
      )}

      <path d={path(average)} fill="none" stroke="#94a3b8" strokeWidth="1.1" strokeDasharray="4 3" />
      <path d={path(daily)} fill="none" stroke="#38bdf8" strokeWidth="1.6" strokeLinejoin="round" />

      {labels.map((label, i) =>
        i % tickEvery === 0 || i === n - 1 ? (
          <text key={label + i} x={x(i)} y={H - 5} textAnchor="middle" fontSize="8.5" fill="#64809f">
            {label}
          </text>
        ) : null,
      )}
    </svg>
  );
}
