export type Coverage = {
  matched: number;
  total: number;
  excluded: number;
  rate: number | null;
};
export type Metrics = {
  U: number;
  G: number;
  N: number;
  C: number | null;
  allocation_rate: number;
  unmet_passengers: number | null;
  average_process_minutes: number | null;
  coverage: Coverage;
};
export type Gate = {
  gate_id: string;
  terminal: string;
  region: string;
  arr_types: string[];
  dep_types: string[];
  body_type: string;
};
export type Turn = {
  turnaround_id: string;
  arrival_at: string;
  departure_at: string;
  arrival_flight: string;
  departure_flight: string;
  arrival_type: string;
  departure_type: string;
  body_type: string;
};
export type Transfer = {
  transfer_group_id: string;
  passenger_count: number;
  arrival_gate: string;
  departure_gate: string;
  cost: number;
  process_minutes: number | null;
  connection_minutes: number;
  satisfied: boolean;
  reason: string;
};
export type Solution = {
  id: string;
  assignments: Record<string, string>;
  metrics: Metrics;
  validation: { valid: boolean; selectable: boolean; errors: unknown[] };
  transfers?: Transfer[];
};
export type Dataset = {
  id: string;
  name: string;
  day: string;
  gates: Gate[];
  turnarounds: Turn[];
  transfers: unknown[];
  excluded: {
    transfer_group_id: string;
    passenger_count: number;
    reason: string;
  }[];
  coverage: Coverage;
  status: string;
  raw_counts: Record<string, number>;
  rules: { version: string; buffer_minutes: number; timezone: string };
};
export type Run = {
  id: string;
  dataset_id: string;
  status: string;
  created_at?: string;
  config: { mode: string; seed: number; seconds?: number; budget?: string };
  progress?: { evaluations: number; generation: number; elapsed: number };
  result?: {
    solutions: Solution[];
    evaluations: number;
    stop_reason: string;
    candidate_count: number;
  };
  error?: string;
};
export type Demo = {
  dataset: Dataset;
  run: Run;
  precomputed: boolean;
  source: string;
  notice: string;
};
export type Session = {
  mode: string;
  authenticated: boolean;
  ai: {
    configured: boolean;
    provider?: string;
    model?: string;
    disclosure?: string;
  };
};
export type Preview = {
  config: {
    dataset_id: string;
    mode: string;
    budget: string;
    seed: number;
    seconds: number;
  };
  config_hash: string;
  credential: string;
};
export type Evidence = {
  summary: string;
  source: string;
  boundary: string;
  cards: { id: string; metric: string; delta: number; solution_id: string }[];
  changes?: {
    group_id: string;
    passengers: number;
    before: number;
    after: number;
    delta: number;
    from: string;
    to: string;
  }[][];
};
