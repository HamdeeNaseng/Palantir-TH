/** Circular progress ring — the source-confidence KPI. */
export function ConfidenceRing({ value, size = 46 }: { value: number; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`ความเชื่อมั่น ${value}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(56,100,150,0.35)" strokeWidth="4" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#22d3ee"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(c * value) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/** Half-circle risk meter used on the case card. */
export function RiskMeter({ value, width = 96 }: { value: number; width?: number }) {
  const H = width / 2 + 6;
  const cx = width / 2;
  const cy = width / 2;
  const r = width / 2 - 6;
  const angle = Math.PI * (1 - value / 100);
  const nx = cx + r * 0.86 * Math.cos(angle);
  const ny = cy - r * 0.86 * Math.sin(angle);

  return (
    <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={`ความเสี่ยง ${value} จาก 100`}>
      <defs>
        <linearGradient id="risk-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="url(#risk-arc)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#e6f1ff" strokeWidth="2" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="2.6" fill="#e6f1ff" />
    </svg>
  );
}

/** Horizontal reliability bar in the source table. */
export function ScoreBar({ value }: { value: number }) {
  const color = value >= 80 ? "#22c55e" : value >= 70 ? "#4ade80" : value >= 60 ? "#f59e0b" : "#f97316";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(56,100,150,0.25)]">
      <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
    </div>
  );
}
