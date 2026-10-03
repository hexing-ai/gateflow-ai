import { useEffect, useState, useRef } from "react";
import type { FormEvent } from "react";
import {
  Plane,
  LayoutDashboard,
  Database,
  Clock3,
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  Check,
  CheckCheck,
  ShieldCheck,
  Sparkles,
  Download,
  Plus,
  Search,
  Settings2,
  PanelRightClose,
  PanelRightOpen,
  SlidersHorizontal,
  ArrowDownUp,
  Info,
  CalendarDays,
  GitBranch,
  LogIn,
  X,
  Upload,
  FileSpreadsheet,
  Play,
  Square,
  LoaderCircle,
  AlertTriangle,
  Trash2,
  RefreshCw,
  ExternalLink,
  FileCheck2,
  Menu,
} from "lucide-react";
import type {
  Dataset,
  Demo,
  Run,
  Session,
  Solution,
  Turn,
  Preview,
  Evidence,
} from "./types";
import { api, base, staticOnly, fmt, percent, statusName } from "./api";
import { AirportMap, Timeline, Pareto } from "./charts";

const repo = "https://github.com/hexing-ai/gateflow-ai";
const activeStates = ["queued", "running", "validating", "cancelling"];
const metricNames: Record<string, string> = {
  U: "未安排固定口",
  G: "使用固定口",
  C: "中转流程成本",
  unmet_passengers: "模型未满足中转人数",
};
function App() {
  const [demo, setDemo] = useState<Demo | null>(null);
  const [session, setSession] = useState<Session>({
    mode: "demo",
    authenticated: false,
    ai: { configured: false },
  });
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [isDemo, setIsDemo] = useState(true);
  const [page, setPage] = useState<
    "workspace" | "data" | "details" | "history"
  >("workspace");
  const [currentId, setCurrentId] = useState("");
  const [compared, setCompared] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [panel, setPanel] = useState(true);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [flight, setFlight] = useState<Turn | null>(null);
  const [question, setQuestion] = useState("");
  const [explanation, setExplanation] = useState<Evidence | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [history, setHistory] = useState<Run[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState("transfer");
  const [budget, setBudget] = useState("standard");
  const [seed, setSeed] = useState(42);
  const [day, setDay] = useState("2026-10-03");
  const [files, setFiles] = useState<Record<string, File>>({});
  const [mapping, setMapping] = useState("");
  const [aiConfigText, setAiConfigText] = useState("");
  const [aiConfigNotice, setAiConfigNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const submitKey = useRef("");
  const explainContext = useRef("");
  explainContext.current = `${run?.id}:${compared.join(",")}:${currentId}`;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const notify = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  };
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const job = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let disposed = false;
    async function initialize() {
      try {
        const response = await fetch(base + "samples/demo.json");
        if (!response.ok) throw new Error("样例加载失败");
        const d: Demo = await response.json();
        if (disposed) return;
        setDemo(d);
        setDataset(d.dataset);
        setRun(d.run);
        setCurrentId(d.run.result!.solutions[0].id);
        setCompared(d.run.result!.solutions.slice(0, 2).map((s) => s.id));
        if (staticOnly) return;
        const state = await api<Session>("/session");
        if (disposed) return;
        setSession(state);
        const last = localStorage.getItem("gateflow-last-run");
        if (state.authenticated && last) {
          try {
            const r = await api<Run>("/runs/" + last);
            const data = await api<Dataset>("/datasets/" + r.dataset_id);
            if (disposed) return;
            setRun(r);
            setDataset(data);
            setIsDemo(false);
            setCurrentId(r.result?.solutions[0]?.id || "");
            setCompared(r.result?.solutions.slice(0, 2).map((x) => x.id) || []);
          } catch {
            localStorage.removeItem("gateflow-last-run");
          }
        }
      } catch (e) {
        if (!disposed) fail(e);
      }
    }
    void initialize();
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    if (isDemo || !run || !activeStates.includes(run.status)) return;
    const id = setInterval(
      () =>
        api<Run>("/runs/" + run.id)
          .then((r) => {
            setRun(r);
            if (r.status === "completed" && r.result?.solutions.length) {
              setCurrentId(r.result.solutions[0].id);
              setCompared(r.result.solutions.slice(0, 2).map((s) => s.id));
            }
          })
          .catch(fail),
      1000,
    );
    return () => clearInterval(id);
  }, [isDemo, run?.id, run?.status]);
  useEffect(() => {
    setExplanation(null);
    setSelectedId("");
  }, [currentId, run?.id]);
  useEffect(() => {
    setPreview(null);
  }, [mode, budget, seed, dataset?.id]);
  useEffect(() => {
    setExplanation(null);
  }, [compared.join(",")]);
  useEffect(() => {
    if (!isDemo && run) localStorage.setItem("gateflow-last-run", run.id);
  }, [run?.id, isDemo]);
  useEffect(() => {
    if (!flight && !loginOpen && !settingsOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    const nodes = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
        ) || [],
      );
    nodes()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFlight(null);
        setLoginOpen(false);
        setSettingsOpen(false);
      }
      if (e.key === "Tab") {
        const list = nodes();
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [!!flight, loginOpen, settingsOpen]);
  const solutions = run?.result?.solutions || [];
  const current = solutions.find((s) => s.id === currentId) || solutions[0];
  const index = solutions.findIndex((s) => s.id === current?.id);
  const compareSolutions = compared
    .map((id) => solutions.find((s) => s.id === id))
    .filter((s): s is Solution => !!s);
  const isOwner = session.authenticated && !isDemo;
  const readonly = !session.authenticated;
  function loadDemo() {
    if (!demo) return;
    setIsDemo(true);
    setDataset(demo.dataset);
    setRun(demo.run);
    setCurrentId(demo.run.result!.solutions[0].id);
    setCompared(demo.run.result!.solutions.slice(0, 2).map((s) => s.id));
    setPage("workspace");
    setPreview(null);
    setExplanation(null);
  }
  function choose(s: Solution) {
    setCurrentId(s.id);
    setFlight(null);
  }
  function toggleCompare(id: string) {
    setCompared((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 3
          ? [...prev, id]
          : prev,
    );
    if (compared.length === 3 && !compared.includes(id))
      notify("最多比较 3 套方案");
  }
  async function openHistory() {
    setPage("history");
    if (!session.authenticated) return;
    await job(async () => {
      setHistory(await api<Run[]>("/runs"));
      setDatasets(await api<Dataset[]>("/datasets"));
    });
  }
  async function openRun(r: Run) {
    await job(async () => {
      const [full, d] = await Promise.all([
        api<Run>("/runs/" + r.id),
        api<Dataset>("/datasets/" + r.dataset_id),
      ]);
      setRun(full);
      setDataset(d);
      setIsDemo(false);
      setCurrentId(full.result?.solutions[0]?.id || "");
      setCompared(full.result?.solutions.slice(0, 2).map((s) => s.id) || []);
      setPage("workspace");
    });
  }
  async function login(e: FormEvent) {
    e.preventDefault();
    await job(async () => {
      await api("/auth/login", "POST", { password });
      setPassword("");
      setSession(await api<Session>("/session"));
      setLoginOpen(false);
      notify("已登录私人工作空间");
      setPage("data");
    });
  }
  async function upload(e: FormEvent) {
    e.preventDefault();
    await job(async () => {
      const f = new FormData();
      f.append("day", day);
      for (const [k, v] of Object.entries(files)) f.append(k, v);
      f.append("model_mapping", mapping || "{}");
      const d = await api<Dataset>("/datasets", "POST", f);
      setDataset(d);
      setRun(null);
      setIsDemo(false);
      setPreview(null);
      setCurrentId("");
      notify("数据检查完成");
    });
  }
  async function prepare() {
    if (!dataset) return;
    await job(async () => {
      setPreview(
        await api<Preview>("/config/preview", "POST", {
          dataset_id: dataset.id,
          mode,
          budget,
          seed,
        }),
      );
      submitKey.current = crypto.randomUUID();
    });
  }
  async function start() {
    if (!preview) return;
    await job(async () => {
      const r = await api<Run>("/runs", "POST", {
        dataset_id: preview.config.dataset_id,
        mode: preview.config.mode,
        budget: preview.config.budget,
        seed: preview.config.seed,
        confirmed_hash: preview.config_hash,
        credential: preview.credential,
        idempotency_key: submitKey.current,
      });
      setRun(r);
      setIsDemo(false);
      setCurrentId("");
      setCompared([]);
      setPage("workspace");
      setPreview(null);
      notify("任务已提交，可离开页面后返回查看");
    });
  }
  async function propose() {
    if (!dataset) return;
    await job(async () => {
      const r = await api<{
        action: string;
        message: string;
        source: string;
        mode: string;
        budget: string;
        seed: number;
        preview?: Preview;
      }>("/ai/configure", "POST", {
        dataset_id: dataset.id,
        message: aiConfigText,
        request_id: crypto.randomUUID(),
      });
      setAiConfigNotice(
        (r.source === "model" ? "AI 配置建议：" : "规则辅助：") + r.message,
      );
      if (r.preview) {
        setMode(r.mode);
        setBudget(r.budget);
        setSeed(r.seed);
        setTimeout(() => setPreview(r.preview!), 0);
        submitKey.current = crypto.randomUUID();
      }
    });
  }
  function templateExplanation(): Evidence {
    const a = compareSolutions[0];
    const cards = compareSolutions.slice(1).flatMap((s, i) =>
      ["U", "G", "C", "unmet_passengers"].flatMap((k) => {
        const key = k as keyof typeof a.metrics;
        const before = a.metrics[key],
          after = s.metrics[key];
        return typeof before === "number" && typeof after === "number"
          ? [
              {
                id: `comparison-${i}-${k}`,
                metric: k,
                delta: after - before,
                solution_id: s.id,
              },
            ]
          : [];
      }),
    );
    return {
      summary:
        "结合固定口覆盖、资源使用和中转流程成本，查看各方案的收益与代价。",
      cards,
      changes: compareSolutions.slice(1).map((s) => {
        const lookup = new Map(
          (s.transfers || []).map((t) => [t.transfer_group_id, t]),
        );
        return (a.transfers || [])
          .flatMap((x) => {
            const y = lookup.get(x.transfer_group_id);
            if (
              !y ||
              (x.arrival_gate === y.arrival_gate &&
                x.departure_gate === y.departure_gate)
            )
              return [];
            return [
              {
                group_id: x.transfer_group_id,
                passengers: x.passenger_count,
                before: x.cost,
                after: y.cost,
                delta: y.cost - x.cost,
                from: x.arrival_gate + " → " + x.departure_gate,
                to: y.arrival_gate + " → " + y.departure_gate,
              },
            ];
          })
          .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
      }),
      source: "template",
      boundary:
        "成本包含模型惩罚，不等同于旅客实际节省时间。解释仅覆盖可匹配客流。",
    };
  }
  async function explain(q = question) {
    if (compareSolutions.length < 2) {
      notify("请先勾选至少两套候选方案");
      return;
    }
    setQuestion(q);
    setChatBusy(true);
    setError("");
    const contextAtStart = explainContext.current;
    try {
      if (isDemo) {
        if (/步行|实时|误机预测|关闭|锁定/.test(q)) {
          notify("当前模型不支持该问题；可以查看固定口与流程成本差异");
        }
        setExplanation(templateExplanation());
      } else {
        const answer = await api<Evidence>("/ai/explain", "POST", {
          dataset_id: dataset!.id,
          message: q || "解释这些方案的取舍",
          items: compareSolutions.map((s) => ({
            run_id: run!.id,
            solution_id: s.id,
          })),
          request_id: crypto.randomUUID(),
        });
        if (contextAtStart === explainContext.current) setExplanation(answer);
      }
    } catch (e) {
      fail(e);
    } finally {
      setChatBusy(false);
    }
  }
  async function exportCurrent() {
    if (!current || !run) return;
    await job(async () => {
      if (isDemo) {
        const a = document.createElement("a");
        a.href = base + `samples/exports/${current.id}.zip`;
        a.download = `gateflow_sample_${current.id}.zip`;
        a.click();
        notify("已下载合成样例证据包");
      } else {
        const selected = await api<{ id: string }>(
          "/runs/" + run.id + "/selection",
          "POST",
          { solution_id: current.id },
        );
        setSelectedId(current.id);
        const response = await fetch(
          "/api/selections/" + selected.id + "/export",
        );
        if (!response.ok) throw new Error("证据包导出失败，请重试");
        const url = URL.createObjectURL(await response.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = `${run.id}_${current.id}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        notify("已选用方案并导出证据包");
      }
    });
  }
  async function showDetail() {
    if (!current) return;
    if (!isDemo && !current.transfers) {
      await job(async () => {
        const s = await api<Solution>(
          `/runs/${run!.id}/solutions/${current.id}`,
        );
        setRun((prev) =>
          prev && prev.result
            ? {
                ...prev,
                result: {
                  ...prev.result,
                  solutions: prev.result.solutions.map((x) =>
                    x.id === s.id ? s : x,
                  ),
                },
              }
            : prev,
        );
      });
    }
    setPage("details");
  }
  if (!dataset)
    return (
      <div className="loading-screen">
        <div className="brand-symbol">
          <Plane />
        </div>
        <h1>GateFlow</h1>
        <p>{error || "正在准备运行日工作台…"}</p>
        {error && <button onClick={() => location.reload()}>重新加载</button>}
      </div>
    );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobileNav ? "nav-open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            loadDemo();
          }}
        >
          <span className="brand-symbol">
            <Plane size={23} />
          </span>
          <span>
            GateFlow<small>登机口分配工作台</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">TS</span>
          <span>
            T / S 航站楼<small>运行分析工作空间</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <div className="nav-caption">工作空间</div>
        <nav>
          {[
            { key: "workspace", label: "方案工作台", Icon: LayoutDashboard },
            { key: "data", label: "数据与任务", Icon: Database },
            { key: "history", label: "历史运行", Icon: Clock3 },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              className={
                page === key || (key === "workspace" && page === "details")
                  ? "active"
                  : ""
              }
              onClick={() => {
                setMobileNav(false);
                key === "history"
                  ? void openHistory()
                  : setPage(key as typeof page);
              }}
            >
              <Icon size={18} />
              {label}
              {key === "workspace" && (
                <span className="nav-count">{solutions.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-caption">当前分析</div>
        <div className="analysis-meta">
          <span>
            <i className="dot teal" /> {isDemo ? "合成样例" : "私人数据"}
          </span>
          <strong>{dataset.day.replaceAll("-", " / ")}</strong>
          <p>
            {dataset.turnarounds.length} 条周转 · {dataset.gates.length}{" "}
            个登机口
          </p>
        </div>
        <div className="sidebar-bottom">
          <div className="boundary-card">
            <ShieldCheck size={20} />
            <strong>每一个结论，都可追溯</strong>
            <p>独立约束检查、计算明细与版本记录，让方案有据可依。</p>
            <button
              onClick={() => {
                setSettingsOpen(true);
              }}
            >
              查看模型边界 <ArrowUpRight size={13} />
            </button>
          </div>
          <a
            className="source-link"
            href={repo}
            target="_blank"
            rel="noreferrer"
          >
            <GitBranch size={16} /> GitHub 开源项目 <ExternalLink size={12} />
          </a>
          <button
            className="profile"
            onClick={() =>
              session.authenticated ? setSettingsOpen(true) : setLoginOpen(true)
            }
          >
            <span className="avatar">{session.authenticated ? "O" : "G"}</span>
            <span>
              {session.authenticated ? "工作空间所有者" : "公开演示"}
              <small>
                {session.authenticated
                  ? "私人工作空间已解锁"
                  : "只读样例 · 无需登录"}
              </small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="切换导航"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={20} />
            </button>
            <span>工作空间</span>
            <ChevronRight size={13} />
            <strong>
              {page === "workspace"
                ? "方案工作台"
                : page === "data"
                  ? "数据与任务"
                  : page === "history"
                    ? "历史运行"
                    : "方案详情"}
            </strong>
          </div>
          <div className="top-actions">
            <span className="environment">
              <i className="dot teal" />
              {isDemo ? "合成样例 · 预计算" : "私人工作空间"}
            </span>
            <button
              className="icon-button"
              aria-label="查看设置"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={17} />
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="关闭错误"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                GATE ALLOCATION /{" "}
                {page === "data"
                  ? "DATA & TASKS"
                  : page === "history"
                    ? "RUN HISTORY"
                    : "DECISION WORKSPACE"}
              </div>
              <h1>
                {page === "data"
                  ? "从数据开始，生成方案"
                  : page === "history"
                    ? "每次运行，都有记录"
                    : page === "details"
                      ? `方案 ${String(index + 1).padStart(2, "0")} · 分配明细`
                      : "让每一次分配，都有依据。"}
              </h1>
              <p>
                {page === "data"
                  ? "检查数据、明确目标，再启动可追溯的后台计算。"
                  : page === "history"
                    ? "查看计算过程、回到历史快照，复核每一次选择。"
                    : "在资源利用与中转流程成本之间，看清每一个取舍。"}
              </p>
            </div>
            <div className="heading-actions">
              {page === "workspace" || page === "details" ? (
                <>
                  <button
                    className="button secondary"
                    onClick={() => setPanel(!panel)}
                  >
                    {panel ? (
                      <PanelRightClose size={16} />
                    ) : (
                      <PanelRightOpen size={16} />
                    )}
                    方案解读
                  </button>
                  <button
                    className="button primary"
                    onClick={() => setPage("data")}
                  >
                    <Plus size={16} />
                    新建分析
                  </button>
                </>
              ) : (
                <button className="button secondary" onClick={loadDemo}>
                  <Play size={15} />
                  浏览演示样例
                </button>
              )}
            </div>
          </div>
          {page === "data" ? (
            <div className="data-layout">
              <section className="panel upload-panel">
                <div className="panel-head">
                  <div>
                    <h2>运行日数据</h2>
                    <p>UTF-8 CSV · 每个文件最多 5 MB</p>
                  </div>
                  <FileSpreadsheet size={22} />
                </div>
                {readonly && (
                  <div className="notice">
                    <Info size={18} />
                    <div>
                      {session.mode === "full"
                        ? "登录后可上传私人数据。"
                        : "公开演示不接受私人文件，不运行后台求解。"}
                      <br />
                      <a
                        href={repo + "#完整后端部署"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看完整后端部署说明 <ArrowUpRight size={12} />
                      </a>
                      {session.mode === "full" && (
                        <button
                          className="link-button"
                          onClick={() => setLoginOpen(true)}
                        >
                          登录工作空间
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <form onSubmit={upload}>
                  <label className="field-label">
                    运行日
                    <input
                      type="date"
                      value={day}
                      onChange={(e) => setDay(e.target.value)}
                      required
                      disabled={readonly}
                    />
                  </label>
                  <div className="upload-slots">
                    {[
                      ["gates", "登机口资源", "必需 · 口位、厅、兼容类型"],
                      [
                        "turnarounds",
                        "飞机周转记录",
                        "必需 · 到离港时间与机体类型",
                      ],
                      [
                        "transfers",
                        "中转旅客组",
                        "成本模式必需 · 航班关联与人数",
                      ],
                    ].map(([key, title, description]) => (
                      <div className="upload-slot" key={key}>
                        <div className="file-icon">
                          <FileSpreadsheet size={23} />
                        </div>
                        <div>
                          <strong>{title}</strong>
                          <p>{files[key]?.name || description}</p>
                          <a href={base + `samples/${key}.csv`} download>
                            下载合成样例模板
                          </a>
                        </div>
                        <label
                          className={
                            "button secondary small " +
                            (readonly ? "disabled" : "")
                          }
                        >
                          <Upload size={14} />
                          {files[key] ? "更换" : "选择文件"}
                          <input
                            type="file"
                            accept=".csv"
                            aria-label={title}
                            disabled={readonly}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) {
                                if (f.size > 5 * 1024 * 1024) {
                                  notify("单文件不能超过 5 MB");
                                  return;
                                }
                                setFiles({ ...files, [key]: f });
                              }
                            }}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                  <details className="advanced">
                    <summary>原始机型映射（可选）</summary>
                    <p>
                      仅原表没有 body_type 时填写。明确指定每个型号的 N/W
                      分类，系统不会猜测。
                    </p>
                    <textarea
                      value={mapping}
                      onChange={(e) => setMapping(e.target.value)}
                      placeholder={'{"已核实的型号": "N"}'}
                      disabled={readonly}
                    />
                  </details>
                  <button
                    className="button primary"
                    disabled={
                      readonly || busy || !files.gates || !files.turnarounds
                    }
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <FileCheck2 size={16} />
                    )}
                    上传并检查数据
                  </button>
                </form>
              </section>
              <section className="panel config-panel">
                <div className="panel-head">
                  <div>
                    <h2>配置本次分析</h2>
                    <p>{isDemo ? "上传数据后可启动私人任务" : dataset.name}</p>
                  </div>
                  <SlidersHorizontal size={20} />
                </div>
                {!isDemo && (
                  <div
                    className={
                      "check-summary " + (dataset.excluded.length ? "warn" : "")
                    }
                  >
                    <ShieldCheck size={18} />
                    <span>
                      {dataset.turnarounds.length} 条周转 ·{" "}
                      {dataset.gates.length} 个口
                      <br />
                      客流覆盖 {dataset.coverage.matched}/
                      {dataset.coverage.total} 人
                    </span>
                  </div>
                )}
                {!isDemo && dataset.status === "needs_confirmation" && (
                  <div className="notice warning">
                    <AlertTriangle size={18} />
                    <div>
                      <strong>{dataset.coverage.excluded} 人需排除</strong>
                      <p>请检查链接缺口，或确认仅分析可匹配范围。</p>
                      <details>
                        <summary>查看排除原因</summary>
                        {dataset.excluded.slice(0, 30).map((x) => (
                          <p key={x.transfer_group_id}>
                            {x.transfer_group_id} · {x.passenger_count} 人 ·{" "}
                            {x.reason}
                          </p>
                        ))}
                      </details>
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() =>
                          job(async () => {
                            setDataset(
                              await api<Dataset>(
                                `/datasets/${dataset.id}/confirm`,
                                "POST",
                              ),
                            );
                            notify("已确认分析范围");
                          })
                        }
                      >
                        仅分析可匹配范围
                      </button>
                    </div>
                  </div>
                )}
                <div className="ai-config">
                  <label>
                    <Sparkles size={15} /> 用一句话描述目标
                  </label>
                  <div className="input-action">
                    <input
                      value={aiConfigText}
                      onChange={(e) => setAiConfigText(e.target.value)}
                      placeholder="重点比较中转成本，标准预算"
                      disabled={!isOwner}
                    />
                    <button
                      className="icon-button"
                      disabled={!isOwner || !aiConfigText || busy}
                      aria-label="生成配置建议"
                      onClick={propose}
                    >
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  {aiConfigNotice && <p>{aiConfigNotice}</p>}
                  <small>
                    {session.ai.configured
                      ? "外部模型调用需在设置中启用"
                      : "模型未配置时使用规则辅助，复杂需求请用表单"}
                  </small>
                </div>
                <label className="field-label">
                  优化目标
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    disabled={!isOwner}
                  >
                    <option value="transfer">中转流程成本 · U / G / C</option>
                    <option value="resource">资源分配 · U / G</option>
                  </select>
                </label>
                <label className="field-label">
                  计算预算
                  <div className="budget-options">
                    {[
                      ["quick", "快速", "30 秒"],
                      ["standard", "标准", "60 秒"],
                      ["thorough", "充分", "180 秒"],
                    ].map(([key, label, time]) => (
                      <button
                        type="button"
                        key={key}
                        className={budget === key ? "selected" : ""}
                        disabled={!isOwner}
                        onClick={() => setBudget(key)}
                      >
                        {label}
                        <small>{time}</small>
                      </button>
                    ))}
                  </div>
                </label>
                <details className="advanced">
                  <summary>高级参数与规则</summary>
                  <label className="field-label">
                    随机种子
                    <input
                      type="number"
                      min="0"
                      max="4294967295"
                      value={seed}
                      onChange={(e) => setSeed(Number(e.target.value))}
                      disabled={!isOwner}
                    />
                  </label>
                  <p>
                    NSGA-II · 种群 80 · 评价上限 40,000 · 缓冲 45 分钟 · T/S
                    研究规则包
                  </p>
                </details>
                {preview ? (
                  <div className="preview-card">
                    <span>
                      <CheckCheck size={16} /> 配置已检查
                    </span>
                    <p>
                      {preview.config.mode === "transfer"
                        ? "中转流程成本"
                        : "资源分配"}{" "}
                      · {preview.config.seconds} 秒 · 种子 {preview.config.seed}
                    </p>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={start}
                    >
                      <Play size={15} />
                      确认并开始生成
                    </button>
                  </div>
                ) : (
                  <button
                    className="button primary wide"
                    disabled={!isOwner || dataset.status !== "ready" || busy}
                    onClick={prepare}
                  >
                    <ArrowRight size={16} />
                    检查运行配置
                  </button>
                )}
              </section>
            </div>
          ) : page === "history" ? (
            <section className="panel history-panel">
              <div className="panel-head">
                <div>
                  <h2>历史运行</h2>
                  <p>配置与数据版本保持不变，结果可随时复核</p>
                </div>
                <button
                  className="button secondary small"
                  onClick={openHistory}
                >
                  <RefreshCw size={14} />
                  刷新
                </button>
              </div>
              {!session.authenticated ? (
                <div className="empty-state">
                  <Clock3 size={35} />
                  <h3>公开演示只展示一份样例</h3>
                  <p>部署完整后端后，可保存私人数据、运行与选择记录。</p>
                  <button className="button primary" onClick={loadDemo}>
                    返回样例工作台
                  </button>
                </div>
              ) : (
                <>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>运行 ID</th>
                          <th>状态</th>
                          <th>目标</th>
                          <th>开始时间</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((r) => (
                          <tr key={r.id}>
                            <td className="mono">{r.id.slice(0, 15)}…</td>
                            <td>
                              <span
                                className={
                                  "tag " +
                                  (r.status === "completed" ? "success" : "")
                                }
                              >
                                {statusName[r.status]}
                              </span>
                            </td>
                            <td>
                              {r.config.mode === "transfer"
                                ? "中转流程成本"
                                : "资源分配"}
                            </td>
                            <td>
                              {r.created_at
                                ? new Date(r.created_at).toLocaleString("zh-CN")
                                : ""}
                            </td>
                            <td>
                              <button
                                className="link-button"
                                onClick={() => openRun(r)}
                              >
                                打开 <ArrowRight size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {history.length === 0 && (
                      <div className="empty-state">
                        还没有运行记录，先导入一份数据。
                      </div>
                    )}
                  </div>
                  <div className="dataset-management">
                    <h3>数据集管理</h3>
                    {datasets.map((d) => (
                      <div className="dataset-line" key={d.id}>
                        <span>
                          {d.name}
                          <small>{d.id}</small>
                        </span>
                        <button
                          className="button danger small"
                          disabled={busy}
                          onClick={() =>
                            job(async () => {
                              const p = await api<{
                                runs: number;
                                solutions: number;
                                active: boolean;
                                message: string;
                              }>(`/datasets/${d.id}/deletion-preview`);
                              if (p.active)
                                throw new Error(
                                  "请先取消并停止该数据集的活动任务",
                                );
                              if (
                                !window.confirm(
                                  `删除 ${d.name}？关联 ${p.runs} 次运行、${p.solutions} 套方案及聊天和导出记录将删除。已下载文件无法收回。`,
                                )
                              )
                                return;
                              await api(
                                `/datasets/${d.id}?confirm=true`,
                                "DELETE",
                              );
                              setDatasets(await api<Dataset[]>("/datasets"));
                              setHistory(await api<Run[]>("/runs"));
                              if (dataset.id === d.id) loadDemo();
                              notify("数据集及关联记录已删除");
                            })
                          }
                        >
                          <Trash2 size={14} />
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          ) : !current ? (
            <section className="panel running-panel">
              <div className="radar">
                <Plane size={32} />
              </div>
              <span className="eyebrow">OPTIMIZATION TASK</span>
              <h2>{run ? statusName[run.status] : "准备生成候选方案"}</h2>
              <p>
                {run?.error
                  ? "任务中断，请检查数据或复制配置重新运行。"
                  : "优化器正在处理占用与兼容关系；结果完成后将进行独立校验。"}
              </p>
              {run && activeStates.includes(run.status) && (
                <>
                  <div className="progress-bar">
                    <i
                      style={{
                        width:
                          Math.min(
                            100,
                            ((run.progress?.elapsed || 0) /
                              (run.config.seconds || 60)) *
                              100,
                          ) + "%",
                      }}
                    />
                  </div>
                  <div className="running-metrics">
                    <span>
                      已评价 <b>{fmt(run.progress?.evaluations || 0)}</b>
                    </span>
                    <span>
                      已耗时 <b>{run.progress?.elapsed || 0} 秒</b>
                    </span>
                  </div>
                  <small>进度条为耗时预算比例，不代表最优解完成度。</small>
                  {["queued", "running", "cancelling"].includes(run.status) && (
                    <button
                      className="button secondary"
                      disabled={busy || run.status === "cancelling"}
                      onClick={() =>
                        job(async () =>
                          setRun(
                            await api<Run>(`/runs/${run.id}/cancel`, "POST"),
                          ),
                        )
                      }
                    >
                      <Square size={14} />
                      取消任务
                    </button>
                  )}
                </>
              )}
              {(!run || !activeStates.includes(run.status)) && (
                <button
                  className="button primary"
                  onClick={() => setPage("data")}
                >
                  返回配置
                </button>
              )}
            </section>
          ) : (
            <>
              <section className="operation-banner">
                <div className="operation-copy">
                  <div className="live-caption">
                    <span className="pulse-dot" />
                    {isDemo ? "SYNTHETIC OPERATION DAY" : "ANALYSIS SNAPSHOT"}
                  </div>
                  <h2>
                    {dataset.day.replaceAll("-", " / ")}
                    <span>运行日</span>
                  </h2>
                  <p>连接航班与旅客，找到更合适的分配。</p>
                  <div className="operation-tags">
                    <span>
                      <Plane size={13} />
                      {dataset.turnarounds.length} 条飞机周转
                    </span>
                    <span>
                      <Database size={13} />
                      {dataset.gates.length} 个固定口
                    </span>
                    <span>
                      <Check size={13} />
                      {dataset.rules.version}
                    </span>
                  </div>
                </div>
                <AirportMap dataset={dataset} solution={current} />
              </section>
              <div className="scope-strip">
                <span>
                  <CalendarDays size={14} />
                  {dataset.day}
                </span>
                <span>
                  <SlidersHorizontal size={14} />
                  {run?.config.mode === "resource"
                    ? "资源分配模式"
                    : "中转流程成本模式"}
                </span>
                <span>
                  <ShieldCheck size={14} />
                  客流覆盖 {dataset.coverage.matched}/{dataset.coverage.total}{" "}
                  人
                </span>
                <span className="scope-note">
                  {isDemo
                    ? "合成数据 · 预计算结果"
                    : "历史数据分析 · 非生产指令"}
                </span>
              </div>
              <div className="metric-grid">
                {[
                  {
                    label: "固定口分配率",
                    value: percent(current.metrics.allocation_rate),
                    unit: "",
                    note: `${current.metrics.N - current.metrics.U} / ${current.metrics.N} 条周转已分配`,
                    Icon: Plane,
                    color: "blue",
                  },
                  {
                    label: "未安排固定口",
                    value: fmt(current.metrics.U),
                    unit: "条",
                    note: "独立列示，未视为真实远机位",
                    Icon: AlertTriangle,
                    color: "amber",
                  },
                  {
                    label: "使用固定口",
                    value: fmt(current.metrics.G),
                    unit: "个",
                    note: `共 ${dataset.gates.length} 个可用固定口`,
                    Icon: LayoutDashboard,
                    color: "teal",
                  },
                  {
                    label: "中转流程成本",
                    value: fmt(current.metrics.C),
                    unit: "人·分钟",
                    note: "包含未满足条件的模型惩罚",
                    Icon: ArrowDownUp,
                    color: "blue",
                  },
                ].map(({ label, value, unit, note, Icon, color }) => (
                  <div className="metric-card" key={label}>
                    <div className="metric-label">
                      {label}
                      <span className={"metric-icon " + color}>
                        <Icon size={16} />
                      </span>
                    </div>
                    <div className="metric-value">
                      {value}
                      <small>{unit}</small>
                    </div>
                    <p>{note}</p>
                  </div>
                ))}
              </div>
              <div
                className={"workspace-grid " + (!panel ? "panel-hidden" : "")}
              >
                <div className="workspace-main">
                  <div className="current-bar">
                    <div>
                      <span className="plan-marker">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <strong>
                        当前查看：方案 {String(index + 1).padStart(2, "0")}
                      </strong>
                      <span className="tag success">
                        <Check size={12} />
                        校验通过
                      </span>
                    </div>
                    <div>
                      <button
                        className="link-button"
                        onClick={() =>
                          page === "details"
                            ? setPage("workspace")
                            : showDetail()
                        }
                      >
                        {page === "details" ? "返回工作台" : "查看明细"}{" "}
                        <ArrowUpRight size={14} />
                      </button>
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={exportCurrent}
                      >
                        <Download size={14} />
                        {isDemo
                          ? "下载样例"
                          : selectedId === current.id
                            ? "再次导出"
                            : "选用并导出"}
                      </button>
                    </div>
                  </div>
                  <Timeline
                    dataset={dataset}
                    solution={current}
                    onFlight={setFlight}
                  />
                  {page === "details" ? (
                    <>
                      <section className="panel">
                        <div className="panel-head">
                          <div>
                            <h2>未安排固定口的周转</h2>
                            <p>以下记录尚无固定口分配，不代表已安排远机位</p>
                          </div>
                          <span className="tag warning">
                            {current.metrics.U} 条
                          </span>
                        </div>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>周转 ID</th>
                                <th>入港航班</th>
                                <th>到达时间</th>
                                <th>出发时间</th>
                                <th>机体</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dataset.turnarounds
                                .filter(
                                  (t) =>
                                    current.assignments[t.turnaround_id] ===
                                    "UNASSIGNED",
                                )
                                .map((t) => (
                                  <tr key={t.turnaround_id}>
                                    <td className="mono">{t.turnaround_id}</td>
                                    <td>{t.arrival_flight}</td>
                                    <td>{t.arrival_at}</td>
                                    <td>{t.departure_at}</td>
                                    <td>{t.body_type}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                          {current.metrics.U === 0 && (
                            <div className="empty-small">
                              <CheckCheck size={18} />
                              所有周转均已安排固定口
                            </div>
                          )}
                        </div>
                      </section>
                      <section className="panel">
                        <div className="panel-head">
                          <div>
                            <h2>中转旅客组明细</h2>
                            <p>
                              平均流程时间{" "}
                              {fmt(current.metrics.average_process_minutes)}{" "}
                              分钟；模型未满足条件{" "}
                              {fmt(current.metrics.unmet_passengers)} 人
                            </p>
                          </div>
                        </div>
                        <div className="table-scroll transfer-table">
                          <table>
                            <thead>
                              <tr>
                                <th>客流组</th>
                                <th>人数</th>
                                <th>路径</th>
                                <th>流程 / 衔接</th>
                                <th>成本</th>
                                <th>模型条件</th>
                              </tr>
                            </thead>
                            <tbody>
                              {current.transfers?.map((t) => (
                                <tr key={t.transfer_group_id}>
                                  <td className="mono">
                                    {t.transfer_group_id}
                                  </td>
                                  <td>{t.passenger_count}</td>
                                  <td>
                                    {t.arrival_gate} → {t.departure_gate}
                                  </td>
                                  <td>
                                    {fmt(t.process_minutes)} /{" "}
                                    {fmt(t.connection_minutes)} 分
                                  </td>
                                  <td>{fmt(t.cost)}</td>
                                  <td>
                                    <span
                                      className={
                                        "tag " +
                                        (t.satisfied ? "success" : "warning")
                                      }
                                    >
                                      {t.reason}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {!current.transfers?.length && (
                            <div className="empty-small">无可评价客流数据</div>
                          )}
                        </div>
                      </section>
                    </>
                  ) : (
                    <div className="candidate-layout">
                      <section className="panel candidates-panel">
                        <div className="panel-head">
                          <div>
                            <h2>
                              候选方案{" "}
                              <span className="small-counter">
                                {solutions.length}
                              </span>
                            </h2>
                            <p>勾选 2–3 套方案，比较完整取舍</p>
                          </div>
                          <label className="search-box">
                            <Search size={14} />
                            <input
                              placeholder="方案 ID"
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                              aria-label="搜索方案 ID"
                            />
                          </label>
                        </div>
                        <div className="table-scroll candidate-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th aria-label="选择比较" />
                                <th>方案</th>
                                <th>未分配</th>
                                <th>固定口</th>
                                <th>流程成本</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {solutions
                                .map((s, i) => ({ s, i }))
                                .filter(({ s }) => s.id.includes(query))
                                .map(({ s, i }) => (
                                  <tr
                                    key={s.id}
                                    className={
                                      s.id === current.id ? "current-row" : ""
                                    }
                                  >
                                    <td>
                                      <input
                                        type="checkbox"
                                        checked={compared.includes(s.id)}
                                        onChange={() => toggleCompare(s.id)}
                                        aria-label={`比较方案 ${i + 1}`}
                                      />
                                    </td>
                                    <td>
                                      <button
                                        className="plan-button"
                                        onClick={() => choose(s)}
                                      >
                                        方案 {String(i + 1).padStart(2, "0")}
                                        {i === 0 && (
                                          <span className="recommend-tag">
                                            排序首位
                                          </span>
                                        )}
                                      </button>
                                      <small className="mono">
                                        {s.id.slice(0, 7)}
                                      </small>
                                    </td>
                                    <td>{s.metrics.U}</td>
                                    <td>{s.metrics.G}</td>
                                    <td className="mono">{fmt(s.metrics.C)}</td>
                                    <td>
                                      <button
                                        className="icon-button"
                                        aria-label={`查看方案 ${i + 1} 时间轴`}
                                        onClick={() => choose(s)}
                                      >
                                        <ChevronRight size={15} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="panel-foot">
                          <span>已选 {compared.length} 套 · 第一套为基准</span>
                          <button
                            className="link-button"
                            onClick={() => {
                              setPanel(true);
                              explain("解释这些方案的取舍");
                            }}
                            disabled={compared.length < 2}
                          >
                            比较并解读 <ArrowRight size={13} />
                          </button>
                        </div>
                      </section>
                      <Pareto
                        solutions={solutions}
                        current={current.id}
                        onSelect={choose}
                      />
                    </div>
                  )}
                  <div className="model-footnote">
                    <Info size={14} />
                    <span>
                      研究规则包：45 分钟缓冲 · T/S 两厅 ·
                      不包含真实步行、捷运或生产下发。通过已建模约束，不代表覆盖全部机场运行规则。
                    </span>
                  </div>
                </div>
                {panel && (
                  <aside className="insight-panel">
                    <div className="insight-heading">
                      <span className="spark-icon">
                        <Sparkles size={19} />
                      </span>
                      <div>
                        <h2>方案解读</h2>
                        <span>
                          {isDemo
                            ? "预计算证据 · 确定性摘要"
                            : session.ai.configured
                              ? "AI 辅助 · 证据约束"
                              : "模型未配置 · 模板摘要"}
                        </span>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="收起解读面板"
                        onClick={() => setPanel(false)}
                      >
                        <PanelRightClose size={16} />
                      </button>
                    </div>
                    <div className="insight-body">
                      <div className="assistant-intro">
                        <h3>看懂数字背后的取舍</h3>
                        <p>从完整方案出发，比较资源、覆盖和中转流程成本。</p>
                      </div>
                      <div className="evidence-status">
                        <ShieldCheck size={16} />
                        <span>
                          当前方案已通过独立校验
                          <small>
                            方案 {String(index + 1).padStart(2, "0")} ·{" "}
                            {current.id.slice(0, 8)}
                          </small>
                        </span>
                      </div>
                      <div className="insight-stat">
                        <span>模型未满足中转条件</span>
                        <strong>
                          {fmt(current.metrics.unmet_passengers)}{" "}
                          <small>人</small>
                        </strong>
                        <p>
                          包含未分配固定口或衔接时间不足；不是实际误机人数。
                        </p>
                      </div>
                      <div className="insight-stat">
                        <span>满足条件组平均流程时间</span>
                        <strong>
                          {fmt(current.metrics.average_process_minutes)}{" "}
                          <small>分钟</small>
                        </strong>
                        <p>按人数加权，仅统计满足条件的组。</p>
                      </div>
                      <div className="insight-divider" />
                      <div className="question-label">
                        比较已勾选的 {compared.length} 套方案
                      </div>
                      <div className="quick-questions">
                        {[
                          "哪套方案的中转成本更低？",
                          "少用登机口，需要付出什么代价？",
                        ].map((q) => (
                          <button
                            key={q}
                            onClick={() => explain(q)}
                            disabled={chatBusy}
                          >
                            {q}
                            <ArrowUpRight size={13} />
                          </button>
                        ))}
                      </div>
                      {explanation && (
                        <div className="answer" aria-live="polite">
                          <span className="answer-label">
                            <Sparkles size={12} />
                            {explanation.source === "template"
                              ? "确定性差异摘要"
                              : "AI 证据摘要"}
                          </span>
                          <p>{explanation.summary}</p>
                          <div className="delta-cards">
                            {explanation.cards.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => {
                                  const s = solutions.find(
                                    (s) => s.id === c.solution_id,
                                  );
                                  if (s) choose(s);
                                }}
                              >
                                <span>
                                  {metricNames[c.metric]}
                                  <small>
                                    方案{" "}
                                    {String(
                                      solutions.findIndex(
                                        (s) => s.id === c.solution_id,
                                      ) + 1,
                                    ).padStart(2, "0")}{" "}
                                    相对基准
                                  </small>
                                </span>
                                <b
                                  className={
                                    c.delta < 0
                                      ? "positive"
                                      : c.delta > 0
                                        ? "negative"
                                        : ""
                                  }
                                >
                                  {c.delta > 0 ? "+" : ""}
                                  {fmt(c.delta)}
                                </b>
                              </button>
                            ))}
                          </div>
                          {explanation.changes?.map((changes, i) => (
                            <details className="contributions" key={i}>
                              <summary>
                                方案{" "}
                                {String(
                                  solutions.findIndex(
                                    (s) => s.id === compareSolutions[i + 1]?.id,
                                  ) + 1,
                                ).padStart(2, "0")}{" "}
                                · {changes.length} 组路径变化
                              </summary>
                              {changes.map((change) => (
                                <div key={change.group_id}>
                                  <strong>
                                    {change.group_id} · {change.passengers} 人{" "}
                                    <b
                                      className={
                                        change.delta < 0
                                          ? "positive"
                                          : change.delta > 0
                                            ? "negative"
                                            : ""
                                      }
                                    >
                                      {change.delta > 0 ? "+" : ""}
                                      {fmt(change.delta)}
                                    </b>
                                  </strong>
                                  <span>
                                    {change.from} → {change.to}
                                  </span>
                                  <span>
                                    {fmt(change.before)} → {fmt(change.after)}{" "}
                                    人·分钟
                                  </span>
                                </div>
                              ))}
                            </details>
                          ))}
                          <p className="answer-boundary">
                            {explanation.boundary}
                          </p>
                        </div>
                      )}
                    </div>
                    <form
                      className="ask-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        explain();
                      }}
                    >
                      <div className="ask-input">
                        <textarea
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          placeholder={
                            isDemo
                              ? "输入问题，查看方案差异摘要…"
                              : "询问当前方案的取舍…"
                          }
                          maxLength={2000}
                          aria-label="方案解读问题"
                        />
                        <button
                          className="send-button"
                          disabled={chatBusy || compared.length < 2}
                          aria-label="发送方案解读问题"
                        >
                          {chatBusy ? (
                            <LoaderCircle size={16} className="spin" />
                          ) : (
                            <ArrowRight size={18} />
                          )}
                        </button>
                      </div>
                      <p>
                        {isDemo
                          ? "演示不调用外部模型，数字来自样例计算"
                          : "数字由程序计算，AI 不直接修改分配"}
                      </p>
                    </form>
                  </aside>
                )}
              </div>
            </>
          )}
          <footer className="app-footer">
            <span>
              GateFlow <span className="muted">/</span> Decision workspace
            </span>
            <span>
              V1.0 <i /> 可追溯 · 可复核 · 人工决策
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={17} />
          {toast}
        </div>
      )}
      {flight && (
        <div className="modal-backdrop" onClick={() => setFlight(null)}>
          <section
            className="modal flight-modal"
            role="dialog"
            aria-modal="true"
            aria-label="周转记录详情"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="关闭周转详情"
              onClick={() => setFlight(null)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">TURNAROUND RECORD</div>
            <h2>
              <Plane size={24} />
              {flight.arrival_flight} <ArrowRight size={18} />{" "}
              {flight.departure_flight}
            </h2>
            <div className="flight-ticket">
              <span>
                到达<strong>{flight.arrival_at.slice(11)}</strong>
                <small>{flight.arrival_at.slice(0, 10)}</small>
              </span>
              <span className="flight-ticket-gate">
                GATE
                <strong>{current?.assignments[flight.turnaround_id]}</strong>
                <small>
                  {flight.body_type === "N" ? "窄体" : "宽体"} ·{" "}
                  {flight.arrival_type}/{flight.departure_type}
                </small>
              </span>
              <span>
                出发<strong>{flight.departure_at.slice(11)}</strong>
                <small>{flight.departure_at.slice(0, 10)}</small>
              </span>
            </div>
            <p className="notice">
              <Info size={16} />
              占用结束包含离港后 45 分钟缓冲。
            </p>
            <div className="mono muted">
              {flight.turnaround_id} · {current?.id}
            </div>
          </section>
        </div>
      )}
      {loginOpen && (
        <div className="modal-backdrop" onClick={() => setLoginOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="工作空间登录"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="关闭登录"
              onClick={() => setLoginOpen(false)}
            >
              <X size={20} />
            </button>
            <span className="spark-icon">
              <LogIn size={24} />
            </span>
            <h2>进入私人工作空间</h2>
            {session.mode === "full" ? (
              <form onSubmit={login}>
                <p>使用部署时设置的所有者密码。</p>
                <label className="field-label">
                  所有者密码
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </label>
                <button className="button primary wide" disabled={busy}>
                  登录工作空间
                </button>
              </form>
            ) : (
              <>
                <p>
                  当前为公开演示。完整后端支持私人数据上传、持久求解任务和模型接入，可在自己的环境部署。
                </p>
                <a
                  className="button primary"
                  href={repo + "#完整后端部署"}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看部署说明 <ExternalLink size={15} />
                </a>
              </>
            )}
          </section>
        </div>
      )}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <section
            className="modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="规则与模型设置"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="关闭设置"
              onClick={() => setSettingsOpen(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">WORKSPACE SETTINGS</div>
            <h2>规则与模型设置</h2>
            <dl className="settings-list">
              <div>
                <dt>规则包</dt>
                <dd>{dataset.rules.version}</dd>
              </div>
              <div>
                <dt>占用缓冲</dt>
                <dd>45 分钟</dd>
              </div>
              <div>
                <dt>求解步长</dt>
                <dd>5 分钟，向外取整</dd>
              </div>
              <div>
                <dt>未满足中转条件惩罚</dt>
                <dd>180 分钟 / 人（模型参数）</dd>
              </div>
              <div>
                <dt>时间范围</dt>
                <dd>占用区间与运行日相交</dd>
              </div>
              <div>
                <dt>外部模型</dt>
                <dd>
                  {session.ai.configured
                    ? session.ai.provider + " / " + session.ai.model
                    : "未配置"}
                </dd>
              </div>
            </dl>
            <p className="notice">
              <Info size={17} />
              当前不包含真实步行、捷运、动态机位关闭、实时重排及生产指令下发。
            </p>
            {session.authenticated && session.ai.configured && (
              <div className="consent-box">
                <p>{session.ai.disclosure}</p>
                <p>
                  每日最多 100
                  次调用；价格未配置时费用未知。密钥仅保存在服务端。
                </p>
                <button
                  className="button primary"
                  onClick={() =>
                    job(async () => {
                      await api("/ai/consent", "POST", { enabled: true });
                      notify("已启用外部模型调用");
                      setSettingsOpen(false);
                    })
                  }
                >
                  同意上述范围并启用
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    job(async () => {
                      await api("/ai/consent", "POST", { enabled: false });
                      notify("已停用外部模型调用");
                    })
                  }
                >
                  停用外部模型
                </button>
              </div>
            )}
            {session.authenticated && (
              <button
                className="button secondary"
                onClick={() =>
                  job(async () => {
                    await api("/auth/logout", "POST");
                    setSession(await api<Session>("/session"));
                    setSettingsOpen(false);
                    loadDemo();
                  })
                }
              >
                退出私人工作空间
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
export default App;
