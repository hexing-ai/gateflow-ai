import { useState } from "react";
import { Plane, ArrowUpRight, Check } from "lucide-react";
import type { Dataset, Solution, Turn } from "./types";
import { fmt } from "./api";

export function AirportMap({
  dataset,
  solution,
}: {
  dataset: Dataset;
  solution: Solution;
}) {
  const used = new Set(Object.values(solution.assignments));
  return (
    <div
      className="airport-map"
      aria-label="T 与 S 航站楼资源示意，非实际机场地图"
    >
      <svg
        viewBox="0 0 560 220"
        role="img"
        aria-label={`${used.size - (used.has("UNASSIGNED") ? 1 : 0)} 个固定口被使用`}
      >
        <defs>
          <pattern
            id="map-grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke="#33516c"
              strokeWidth=".5"
            />
          </pattern>
        </defs>
        <rect width="560" height="220" fill="url(#map-grid)" />
        <path d="M26 181H536M26 188H536" stroke="#37556e" fill="none" />
        <path d="M40 184H520" stroke="#53718a" strokeDasharray="16 10" />
        <path
          d="M254 92h51"
          stroke="#45647d"
          strokeWidth="9"
          strokeDasharray="5 4"
        />
        {["T", "S"].map((terminal, side) => {
          const x = side ? 325 : 55;
          const gates = dataset.gates
            .filter((g) => g.terminal === terminal)
            .slice(0, 12);
          return (
            <g key={terminal}>
              <rect
                x={x}
                y="71"
                width="175"
                height="46"
                rx="7"
                fill={side ? "#174f60" : "#254b6c"}
                stroke={side ? "#31878b" : "#5585af"}
              />
              <text
                x={x + 87}
                y="100"
                textAnchor="middle"
                fill="#dbebf7"
                fontSize="14"
                letterSpacing="3"
              >
                {terminal} TERMINAL
              </text>
              {gates.map((g, i) => {
                const upper = i < Math.ceil(gates.length / 2);
                const col = i % Math.ceil(gates.length / 2);
                const px =
                  x +
                  22 +
                  col * (130 / Math.max(1, Math.ceil(gates.length / 2) - 1));
                return (
                  <g key={g.gate_id}>
                    <path
                      d={`M${px} ${upper ? 71 : 117}v${upper ? -20 : 20}`}
                      stroke={
                        used.has(g.gate_id)
                          ? side
                            ? "#67c9c6"
                            : "#82b9ec"
                          : "#46657c"
                      }
                      strokeWidth="5"
                    />
                    <circle
                      cx={px}
                      cy={upper ? 45 : 143}
                      r="4"
                      fill={
                        used.has(g.gate_id)
                          ? side
                            ? "#67c9c6"
                            : "#82b9ec"
                          : "#46657c"
                      }
                    />
                    <text
                      x={px}
                      y={upper ? 29 : 164}
                      textAnchor="middle"
                      fontSize="9"
                      fill="#9cb3c6"
                    >
                      {g.gate_id}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
        <path
          d="M277 158l7 19 20 6-1 4-20-2-3 13h-4l-3-13-20 2-1-4 20-6z"
          fill="#b3cddd"
          transform="rotate(90 277 178)"
        />
      </svg>
      <span className="map-caption">
        航站楼资源示意 <span>● 已使用 &nbsp; ○ 空闲</span>
      </span>
    </div>
  );
}
function minute(time: string, day: string) {
  return (
    (new Date(time.replace(" ", "T") + "+08:00").getTime() -
      new Date(day + "T00:00:00+08:00").getTime()) /
    60000
  );
}

export function Timeline({
  dataset,
  solution,
  onFlight,
}: {
  dataset: Dataset;
  solution: Solution;
  onFlight: (t: Turn) => void;
}) {
  const [terminal, setTerminal] = useState("all");
  const [zoom, setZoom] = useState(false);
  const gates = dataset.gates.filter(
    (g) => terminal === "all" || g.terminal === terminal,
  );
  const starts = dataset.turnarounds.map((t) =>
    minute(t.arrival_at, dataset.day),
  );
  const ends = dataset.turnarounds.map(
    (t) => minute(t.departure_at, dataset.day) + 45,
  );
  const lo = zoom ? 0 : Math.max(0, Math.floor(Math.min(...starts) / 60) * 60);
  const hi = zoom
    ? 1440
    : Math.min(1440, Math.ceil(Math.max(...ends) / 60) * 60);
  const span = Math.max(60, hi - lo);
  const ticks = Array.from(
    { length: Math.floor(span / 120) + 1 },
    (_, i) => lo + i * 120,
  );
  return (
    <section className="panel timeline-panel">
      <div className="panel-head">
        <div>
          <h2>
            登机口占用时间轴{" "}
            <span className="small-counter">{gates.length} 个口</span>
          </h2>
          <p>点击航班查看占用明细；斜线区域为离港后缓冲</p>
        </div>
        <div className="segmented" aria-label="航站楼筛选">
          {[
            ["all", "全部"],
            ["T", "T 厅"],
            ["S", "S 厅"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={terminal === key ? "selected" : ""}
              onClick={() => setTerminal(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="timeline-legend">
        <span>
          <i className="dot blue" />T 厅
        </span>
        <span>
          <i className="dot teal" />S 厅
        </span>
        <span>
          <i className="hatch" />
          45 分钟缓冲
        </span>
        <button onClick={() => setZoom(!zoom)}>
          {zoom ? "聚焦运行时段" : "查看完整运行日"} <ArrowUpRight size={12} />
        </button>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-inner">
          <div className="timeline-ruler">
            <span className="gate-heading">GATE / 登机口</span>
            <div className="track ticks">
              {ticks.map((t) => (
                <span key={t} style={{ left: ((t - lo) / span) * 100 + "%" }}>
                  {String(Math.floor(t / 60)).padStart(2, "0")}:00
                </span>
              ))}
            </div>
          </div>
          <div className="gate-rows">
            {gates.map((g) => (
              <div className="gate-row" key={g.gate_id}>
                <div className="gate-label">
                  <i
                    className={"dot " + (g.terminal === "T" ? "blue" : "teal")}
                  />
                  <strong>{g.gate_id}</strong>
                  <span>{g.body_type}</span>
                </div>
                <div className="track">
                  {ticks.map((t) => (
                    <i
                      className="gridline"
                      key={t}
                      style={{ left: ((t - lo) / span) * 100 + "%" }}
                    />
                  ))}
                  {dataset.turnarounds
                    .filter(
                      (t) =>
                        solution.assignments[t.turnaround_id] === g.gate_id,
                    )
                    .map((t) => {
                      const start = minute(t.arrival_at, dataset.day);
                      const dep = minute(t.departure_at, dataset.day);
                      const end = dep + 45;
                      const left = Math.max(start, lo);
                      const right = Math.min(end, hi);
                      if (right <= left) return null;
                      return (
                        <button
                          className={
                            "flight-bar " +
                            (g.terminal === "T" ? "flight-blue" : "flight-teal")
                          }
                          key={t.turnaround_id}
                          onClick={() => onFlight(t)}
                          style={{
                            left: ((left - lo) / span) * 100 + "%",
                            width: ((right - left) / span) * 100 + "%",
                          }}
                          title={`${t.arrival_flight} · ${t.arrival_at} → ${t.departure_at} · ${g.gate_id}`}
                        >
                          <span
                            className="flight-solid"
                            style={{
                              width:
                                (Math.max(0, Math.min(dep, hi) - left) /
                                  (right - left)) *
                                  100 +
                                "%",
                            }}
                          >
                            <Plane size={11} />
                            {t.arrival_flight}
                          </span>
                          <span className="flight-buffer" />
                          <span className="sr-only">
                            {t.turnaround_id}，{g.gate_id}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="panel-foot">
        <span>
          <Check size={13} /> 已通过本版占用与兼容检查
        </span>
        <span>当地时间 UTC+8 · {dataset.day}</span>
      </div>
    </section>
  );
}

export function Pareto({
  solutions,
  current,
  onSelect,
}: {
  solutions: Solution[];
  current: string;
  onSelect: (s: Solution) => void;
}) {
  const xs = solutions.map((s) => s.metrics.C ?? s.metrics.G);
  const ys = solutions.map((s) => s.metrics.U);
  const minX = Math.min(...xs) * 0.95;
  const maxX = Math.max(...xs) * 1.04;
  const maxY = Math.max(1, ...ys) + 1;
  const xp = (v: number) => 48 + ((v - minX) / Math.max(1, maxX - minX)) * 290;
  const yp = (v: number) => 145 - (v / maxY) * 115;
  return (
    <section className="panel pareto-panel">
      <div className="panel-head">
        <div>
          <h2>方案取舍分布</h2>
          <p>每个点是一套完整分配方案</p>
        </div>
        <span className="tag">本次候选</span>
      </div>
      <svg
        viewBox="0 0 380 195"
        role="img"
        aria-label="候选方案成本与未分配数分布图"
      >
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <path
              d={`M48 ${145 - i * 35}H348`}
              stroke="#e8eef4"
              strokeDasharray="3 4"
            />
            <text
              x="37"
              y={149 - i * 35}
              textAnchor="end"
              fontSize="10"
              fill="#7d8da0"
            >
              {Math.round(((i * 35) / 115) * maxY)}
            </text>
          </g>
        ))}
        <text x="48" y="16" fontSize="10" fill="#7d8da0">
          未分配 / 条
        </text>
        {solutions.map((s, i) => (
          <g
            key={s.id}
            role="button"
            tabIndex={0}
            aria-label={`查看方案 ${i + 1}`}
            onClick={() => onSelect(s)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(s);
              }
            }}
            className="plot-point"
          >
            <circle
              cx={xp(xs[i])}
              cy={yp(ys[i])}
              r={s.id === current ? 8 : 5}
              fill={s.id === current ? "#2478d4" : "#a8c9e8"}
              stroke="white"
              strokeWidth="2"
            />
            {s.id === current && (
              <circle
                cx={xp(xs[i])}
                cy={yp(ys[i])}
                r="13"
                fill="none"
                stroke="#2478d4"
                opacity=".25"
              />
            )}
            <title>{`方案 ${i + 1}：未分配 ${ys[i]}，成本 ${fmt(xs[i])}`}</title>
          </g>
        ))}
        <text x="48" y="165" fontSize="10" fill="#7d8da0">
          {fmt(minX)}
        </text>
        <text x="342" y="165" textAnchor="end" fontSize="10" fill="#7d8da0">
          {fmt(maxX)}
        </text>
        <text x="200" y="190" textAnchor="middle" fontSize="10" fill="#7d8da0">
          {solutions[0]?.metrics.C == null
            ? "使用固定口 / 个"
            : "中转流程成本 / 人·分钟"}{" "}
          →
        </text>
      </svg>
    </section>
  );
}
