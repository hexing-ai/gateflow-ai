import { useState } from "react";
import { Plane, ArrowUpRight, Check } from "lucide-react";
import type { Dataset, Solution, Turn } from "./types";
import { base, fmt } from "./api";

export function AirportMap({
  dataset,
  solution,
  selectedGate,
  onGate,
}: {
  dataset: Dataset;
  solution: Solution;
  selectedGate: string;
  onGate: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const used = new Set(Object.values(solution.assignments));
  return (
    <section className="panel resource-panel">
      <div className="resource-heading">
        <div>
          <h2>航站楼资源示意</h2>
          <span>布局示意 · 非实际机场</span>
        </div>
        <div className="resource-legend">
          <span>
            <i className="dot blue" />T 厅
          </span>
          <span>
            <i className="dot teal" />S 厅
          </span>
          <span className="unused-key">未使用</span>
          <button
            className="link-button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? "展开" : "收起"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div
            className={
              "terminal-scene" +
              (["T", "S"].some(
                (t) => dataset.gates.filter((g) => g.terminal === t).length > 6,
              )
                ? " crowded"
                : "")
            }
          >
            <img
              src={base + "terminal-apron.jpg"}
              width="2172"
              height="724"
              alt="T 与 S 两座航站楼的建筑示意背景"
            />
            <div className="terminal-titles">
              <span>T TERMINAL</span>
              <span>S TERMINAL</span>
            </div>
            <div className="terminal-gates">
              {["T", "S"].map((terminal) => (
                <div
                  key={terminal}
                  className={"gate-cluster terminal-" + terminal}
                >
                  {dataset.gates
                    .filter((g) => g.terminal === terminal)
                    .map((g) => (
                      <button
                        key={g.gate_id}
                        className={
                          "gate-pin " +
                          (used.has(g.gate_id) ? "used" : "unused") +
                          (selectedGate === g.gate_id ? " focused" : "")
                        }
                        aria-pressed={selectedGate === g.gate_id}
                        aria-label={`${g.gate_id}，${used.has(g.gate_id) ? "本方案已使用" : "本方案未使用"}，筛选时间轴`}
                        onClick={() =>
                          onGate(selectedGate === g.gate_id ? "" : g.gate_id)
                        }
                        title={`查看 ${g.gate_id} 占用时间轴`}
                      >
                        {g.gate_id}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </div>
          <div className="resource-caption">
            <span>点击登机口，聚焦占用时间轴</span>
            <span>按整套方案标记使用状态 · 非实时停靠</span>
          </div>
        </>
      )}
    </section>
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
  selectedGate,
  onClearGate,
  onDetail,
  detailLabel,
}: {
  dataset: Dataset;
  solution: Solution;
  onFlight: (t: Turn) => void;
  selectedGate: string;
  onClearGate: () => void;
  onDetail: () => void;
  detailLabel: string;
}) {
  const [terminal, setTerminal] = useState("all");
  const [zoom, setZoom] = useState(false);
  const gates = dataset.gates.filter((g) =>
    selectedGate
      ? g.gate_id === selectedGate
      : terminal === "all" || g.terminal === terminal,
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
              className={!selectedGate && terminal === key ? "selected" : ""}
              aria-pressed={!selectedGate && terminal === key}
              onClick={() => {
                onClearGate();
                setTerminal(key);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="timeline-legend">
        {selectedGate && (
          <button className="gate-filter" onClick={onClearGate}>
            聚焦 {selectedGate} · 清除 ×
          </button>
        )}
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
        <button className="link-button" onClick={onDetail}>
          {detailLabel} <ArrowUpRight size={13} />
        </button>
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
