'use client';

import type { ReactNode } from 'react';

type Point = { label: string; value: number; color?: string };

const INK = 'var(--ink2)';
const LINE = 'var(--line)';
const ACCENT = 'var(--a1)';
const MUTED = 'var(--ink3)';

export function BarChart({
  title,
  points,
  height = 140,
}: {
  title: string;
  points: { date: string; value: number }[];
  height?: number;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = Math.max(points.length * 18, 240);
  const pad = { t: 12, r: 8, b: 28, l: 8 };
  const innerH = height - pad.t - pad.b;
  const barW = Math.max(4, (w - pad.l - pad.r) / Math.max(points.length, 1) - 4);

  return (
    <ChartCard title={title}>
      {points.every((p) => p.value === 0) ? (
        <Empty />
      ) : (
        <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={title}>
          {points.map((p, i) => {
            const x = pad.l + i * ((w - pad.l - pad.r) / points.length) + 2;
            const h = (p.value / max) * innerH;
            const y = pad.t + innerH - h;
            const showLabel = points.length <= 10 || i % Math.ceil(points.length / 7) === 0;
            return (
              <g key={p.date}>
                <rect x={x} y={y} width={barW} height={Math.max(h, 1)} rx={2} fill={ACCENT} opacity={0.85} />
                {showLabel && (
                  <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize={9} fill={MUTED}>
                    {p.date.slice(5)}
                  </text>
                )}
                {p.value > 0 && points.length <= 14 && (
                  <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={9} fill={INK}>
                    {p.value}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </ChartCard>
  );
}

export function DualBarChart({
  title,
  points,
}: {
  title: string;
  points: { date: string; a: number; b: number }[];
  aLabel?: string;
  bLabel?: string;
}) {
  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b]));
  const height = 150;
  const w = Math.max(points.length * 22, 240);
  const pad = { t: 14, r: 8, b: 28, l: 8 };
  const innerH = height - pad.t - pad.b;
  const groupW = (w - pad.l - pad.r) / Math.max(points.length, 1);
  const barW = Math.max(3, groupW / 2 - 3);

  return (
    <ChartCard title={title}>
      <div className="mb-2 flex gap-3 text-[10px] text-[var(--ink3)]">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: ACCENT }} /> Images
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-sky-400" /> Videos
        </span>
      </div>
      {points.every((p) => p.a === 0 && p.b === 0) ? (
        <Empty />
      ) : (
        <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={title}>
          {points.map((p, i) => {
            const x0 = pad.l + i * groupW + 2;
            const ha = (p.a / max) * innerH;
            const hb = (p.b / max) * innerH;
            const showLabel = points.length <= 10 || i % Math.ceil(points.length / 7) === 0;
            return (
              <g key={p.date}>
                <rect
                  x={x0}
                  y={pad.t + innerH - ha}
                  width={barW}
                  height={Math.max(ha, p.a ? 1 : 0)}
                  rx={2}
                  fill={ACCENT}
                  opacity={0.9}
                />
                <rect
                  x={x0 + barW + 2}
                  y={pad.t + innerH - hb}
                  width={barW}
                  height={Math.max(hb, p.b ? 1 : 0)}
                  rx={2}
                  className="fill-sky-400"
                  opacity={0.9}
                />
                {showLabel && (
                  <text x={x0 + groupW / 2 - 2} y={height - 8} textAnchor="middle" fontSize={9} fill={MUTED}>
                    {p.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </ChartCard>
  );
}

export function HBarList({
  title,
  items,
  maxItems = 8,
}: {
  title: string;
  items: Point[];
  maxItems?: number;
}) {
  const slice = items.slice(0, maxItems);
  const max = Math.max(1, ...slice.map((i) => i.value));
  return (
    <ChartCard title={title}>
      {slice.length === 0 ? (
        <Empty />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {slice.map((item) => (
            <li key={item.label} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="truncate text-[var(--ink2)]">{item.label}</span>
                <span className="shrink-0 font-mono text-[11px] text-[var(--ink3)]">{item.value}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full" style={{ background: LINE }}>
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${(item.value / max) * 100}%`,
                    background: item.color || ACCENT,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

export function DonutSplit({
  title,
  a,
  b,
  aLabel = 'Images',
  bLabel = 'Videos',
}: {
  title: string;
  a: number;
  b: number;
  aLabel?: string;
  bLabel?: string;
}) {
  const total = a + b;
  const r = 42;
  const c = 2 * Math.PI * r;
  const aLen = total ? (a / total) * c : 0;
  const bLen = total ? (b / total) * c : 0;

  return (
    <ChartCard title={title}>
      {total === 0 ? (
        <Empty />
      ) : (
        <div className="flex items-center gap-4">
          <svg width={110} height={110} viewBox="0 0 110 110" className="shrink-0">
            <circle cx={55} cy={55} r={r} fill="none" stroke={LINE} strokeWidth={12} />
            <circle
              cx={55}
              cy={55}
              r={r}
              fill="none"
              stroke={ACCENT}
              strokeWidth={12}
              strokeDasharray={`${aLen} ${c - aLen}`}
              strokeDashoffset={c / 4}
              transform="rotate(-90 55 55)"
            />
            <circle
              cx={55}
              cy={55}
              r={r}
              fill="none"
              className="stroke-sky-400"
              strokeWidth={12}
              strokeDasharray={`${bLen} ${c - bLen}`}
              strokeDashoffset={c / 4 - aLen}
              transform="rotate(-90 55 55)"
            />
            <text x={55} y={52} textAnchor="middle" fontSize={16} fontWeight={600} fill="var(--ink)">
              {total}
            </text>
            <text x={55} y={68} textAnchor="middle" fontSize={9} fill={MUTED}>
              total
            </text>
          </svg>
          <div className="flex flex-col gap-2 text-[12px]">
            <div>
              <span className="text-[var(--ink3)]">{aLabel}</span>
              <div className="text-[18px] font-semibold tracking-tight">{a}</div>
            </div>
            <div>
              <span className="text-[var(--ink3)]">{bLabel}</span>
              <div className="text-[18px] font-semibold tracking-tight">{b}</div>
            </div>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">{title}</span>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="py-6 text-center text-xs text-[var(--ink3)]">No data in range</p>;
}
