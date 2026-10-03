from __future__ import annotations
import time
import math
import numpy as np
from pymoo.algorithms.moo.nsga2 import NSGA2
from pymoo.core.problem import Problem
from pymoo.core.repair import Repair
from pymoo.core.sampling import Sampling
from pymoo.core.callback import Callback
from pymoo.operators.crossover.ux import UniformCrossover
from pymoo.util.nds.non_dominated_sorting import NonDominatedSorting
from pymoo.optimize import minimize
from .domain import compatible, timestamp, metrics, validate, digest, UNASSIGNED


class GateProblem(Problem):
    def __init__(self, dataset, mode):
        self.dataset, self.mode = dataset, mode
        self.turns = dataset["turnarounds"]
        self.gates = dataset["gates"]
        self.feasible = [
            [i + 1 for i, g in enumerate(self.gates) if compatible(t, g)]
            for t in self.turns
        ]
        self.starts = np.array(
            [
                math.floor(timestamp(t["arrival_at"]).timestamp() / 300)
                for t in self.turns
            ]
        )
        self.ends = np.array(
            [
                math.ceil((timestamp(t["departure_at"]).timestamp() + 2700) / 300)
                for t in self.turns
            ]
        )
        self.order = np.argsort(self.starts, kind="stable")
        super().__init__(
            n_var=len(self.turns),
            n_obj=3 if mode == "transfer" else 2,
            xl=0,
            xu=len(self.gates),
            vtype=int,
        )

    def decode(self, x):
        return {
            t["turnaround_id"]: self.gates[int(v) - 1]["gate_id"]
            if int(v) > 0
            else UNASSIGNED
            for t, v in zip(self.turns, x)
        }

    def repair(self, x):
        x = np.rint(x).astype(int).copy()
        occupied = [[] for _ in range(len(self.gates) + 1)]
        for i in self.order:
            v = x[i]
            if v == 0:
                continue
            choices = ([v] if v in self.feasible[i] else []) + [
                g for g in self.feasible[i] if g != v
            ]
            x[i] = 0
            for g in choices:
                if all(
                    self.ends[i] <= a or self.starts[i] >= b for a, b in occupied[g]
                ):
                    x[i] = g
                    occupied[g].append((self.starts[i], self.ends[i]))
                    break
        return x

    def _evaluate(self, X, out, *args, **kwargs):
        values = []
        for x in X:
            m, _ = metrics(self.dataset, self.decode(x))
            v = [m["U"], m["G"]]
            if self.mode == "transfer":
                v.append(m["C"])
            values.append(v)
        out["F"] = np.asarray(values, dtype=float)


class GateRepair(Repair):
    def _do(self, problem, X, **kwargs):
        return np.array([problem.repair(x) for x in X])


class GateSampling(Sampling):
    def _do(self, problem, n_samples, random_state=None, **kwargs):
        rng = random_state if random_state is not None else np.random.default_rng(42)
        result = []
        for k in range(n_samples):
            drop = (k % 8) / 20
            x = [
                rng.choice(options) if options and rng.random() > drop else 0
                for options in problem.feasible
            ]
            result.append(problem.repair(x))
        return np.array(result)


# Integer mutation avoids treating the gate index as a continuous location.
from pymoo.core.mutation import Mutation


class GateMutation(Mutation):
    def _do(self, problem, X, random_state=None, **kwargs):
        rng = random_state if random_state is not None else np.random.default_rng(42)
        Y = X.copy()
        for x in Y:
            for i in np.flatnonzero(
                rng.random(problem.n_var) < max(1 / problem.n_var, 0.025)
            ):
                x[i] = rng.choice([0] + problem.feasible[i])
        return Y


class Progress(Callback):
    def __init__(self, budget, notify):
        super().__init__()
        self.start = time.monotonic()
        self.budget = budget
        self.emit = notify
        self.reason = "evaluation_limit"

    def notify(self, algorithm):
        pass

    def _update(self, algorithm):
        elapsed = time.monotonic() - self.start
        self.emit(
            {
                "evaluations": algorithm.evaluator.n_eval,
                "generation": algorithm.n_gen,
                "elapsed": round(elapsed, 2),
            }
        )
        if self.budget and elapsed >= self.budget:
            self.reason = "time_budget"
            algorithm.termination.force_termination = True


def solve(
    dataset,
    mode="transfer",
    seed=42,
    seconds=60,
    evaluations=40000,
    notify=lambda x: None,
):
    problem = GateProblem(dataset, mode)
    cb = Progress(seconds, notify)
    algo = NSGA2(
        pop_size=80,
        sampling=GateSampling(),
        crossover=UniformCrossover(prob=0.9),
        mutation=GateMutation(),
        repair=GateRepair(),
        eliminate_duplicates=True,
    )
    result = minimize(
        problem,
        algo,
        termination=("n_eval", evaluations),
        seed=seed,
        callback=cb,
        verbose=False,
    )
    candidates = {}
    if result.pop is not None:
        for x in result.pop.get("X"):
            assignments = problem.decode(x)
            m, _ = metrics(dataset, assignments)
            report = validate(dataset, assignments, m)
            if not report["selectable"]:
                continue
            sid = digest(
                {
                    "rules": dataset["rules_hash"],
                    "scope": dataset["scope_hash"],
                    "assignments": assignments,
                }
            )[:20]
            candidates[sid] = {
                "id": sid,
                "assignments": assignments,
                "metrics": m,
                "validation": report,
                "assignment_hash": digest(assignments),
            }
    items = list(candidates.values())
    if items:
        F = np.array(
            [
                [
                    s["metrics"][k]
                    for k in (["U", "G", "C"] if mode == "transfer" else ["U", "G"])
                ]
                for s in items
            ]
        )
        front = NonDominatedSorting().do(F, only_non_dominated_front=True)
        items = [items[i] for i in front]
        items.sort(
            key=lambda s: (
                s["metrics"]["U"],
                s["metrics"]["C"] if mode == "transfer" else s["metrics"]["G"],
                s["metrics"]["G"],
                s["id"],
            )
        )
    return {
        "solutions": items[:200],
        "candidate_count": len(items),
        "stop_reason": cb.reason,
        "evaluations": result.algorithm.evaluator.n_eval,
        "algorithm": "NSGA-II",
        "seed": seed,
        "rules_version": dataset["rules"]["version"],
    }
