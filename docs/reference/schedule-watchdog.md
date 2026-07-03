# Schedule Watchdog

## What is the Schedule Watchdog?

Provider Workflows and Middleman Workflows both drive their recurring work — supplier status checks, pending transaction processing, governance sync, and more — through [Temporal Schedules](https://docs.temporal.io/schedule). Schedules are reliable, but the failure mode that matters in production is a **silent** one: a schedule can stop firing (a stuck task queue, a wedged Temporal server, a schedule left paused by accident) while everything else in the system looks fine. Nothing errors, nothing pages — the work just quietly stops happening.

The Schedule Watchdog is a small self-heal loop, shared by both workflow workers via `@igniter/temporal`, that runs alongside the normal worker and periodically checks whether every schedule it knows about is still firing on time. When one isn't, it escalates through a bounded set of non-destructive repair actions and records what it did so the state is visible in the admin Workflows UI. It was built in direct response to a real incident where a schedule went dark without any other signal surfacing it.

Implementation: [`packages/temporal/src/scheduleWatchdog.ts`](../../packages/temporal/src/scheduleWatchdog.ts) (detection + heal ladder), [`packages/temporal/src/workflowView.ts`](../../packages/temporal/src/workflowView.ts) (health derivation for the UI).

---

## How Detection Works

The watchdog runs a self-rescheduling tick loop (`SCHEDULE_WATCHDOG_TICK`, default 30s). Each tick, for every configured schedule, it:

1. Calls `handle.describe()` against Temporal, bounded by a 5s deadline so a hung RPC can never stall the loop.
2. If the call fails with a transient error (deadline exceeded, unavailable, timeout — or gRPC codes `DEADLINE_EXCEEDED`/`RESOURCE_EXHAUSTED`/`ABORTED`/`INTERNAL`/`UNAVAILABLE`), the tick is skipped for that schedule. A flaky RPC never counts as staleness.
3. If the schedule is `NOT_FOUND`: in **enforce** mode it's recreated immediately and the heal state is rebased (`resetOnRecreate`) — a new schedule's `numActionsTaken` starts at 0, so the watchdog's own bookkeeping has to start over too. In **observe** mode nothing is created; the row is just marked `observedUnhealthy`.
4. Otherwise it computes a liveness **verdict** from only verified Temporal SDK fields (`state.paused`, `info.runningActions`, `info.recentActions[].takenAt`, `info.createdAt`, `info.numActionsTaken`) — never inferred or coerced:
   - **`paused`** — always respected. The watchdog never unpauses a schedule an operator paused on purpose.
   - **`healthy`** — a run is currently in flight, or the schedule is within its **min-age guard** (`SCHEDULE_WATCHDOG_MIN_AGE`, default 3m) since creation, or its last firing is still within the staleness grace window.
   - **`unknown`** — `createdAt` is missing, or a timestamp lands in the future relative to the watchdog's clock (skew guard). The tick is skipped rather than guessed at.
   - **`stale`** — the time since the last *autonomous* firing exceeds the grace window.

The reference point for "last firing" deliberately excludes the watchdog's own compensating triggers (see below) — otherwise the watchdog could convince itself a schedule is healthy purely because it kept manually triggering it. This is `hasAutonomousFire`: true when the schedule has fired more times than the watchdog has injected via `trigger()` since the last recorded baseline.

The staleness grace window is not a flat timeout — it scales with how often the schedule is supposed to fire:

```
grace = clamp(missedFirings × intervalMs, minGraceMs, graceCapMs)
```

With the defaults (`SCHEDULE_WATCHDOG_MISSED_FIRINGS=5`, a 90s floor, a 600s ceiling), a schedule that runs every 10s is flagged stale after roughly 90s of silence, while one that runs every 5 minutes gets a much longer leash before it's flagged.

---

## The Heal Ladder

When a schedule is confirmed `stale` and the watchdog is in **enforce** mode, it escalates through two non-destructive steps, gated by an in-memory per-schedule backoff so repeated ticks don't hammer the same schedule:

1. **Re-arm via `update()`** (attempts below `SCHEDULE_WATCHDOG_RECREATE_AFTER`, default 2) — the schedule is updated in place with its intended spec and args. This has no "absent" window the way delete-then-recreate would. A **transient** failure here does not consume an attempt (it's retried next eligible tick); a **definitive** failure does, via `bumpAttempt()`.
2. **Reconcile + inject a compensating trigger** (once attempts reach `RECREATE_AFTER`) — `ensureSchedule()` recreates the schedule only if it's genuinely missing (drift is already handled by step 1), then the watchdog fires one manual `trigger()` to make up for the missed run. Critically, `bumpInjectedTrigger()` is written to the database **before** `trigger()` is called (write-ahead) — so the injected-trigger counter can never under-count relative to what was actually sent, even if the process crashes mid-action. This matters because `hasAutonomousFire` depends on that counter being an honest upper bound.

Each definitive action increments `attempts`. If `attempts` reaches `SCHEDULE_WATCHDOG_MAX_HEAL_ATTEMPTS` (default 5), the breaker trips: the schedule is marked `unhealthy` and an error is logged (page-worthy — the watchdog has exhausted its own remediation and a human needs to look).

The ladder isn't manually reset from the UI. It clears itself the next time a tick observes an **autonomous** fire (`hasAutonomousFire` true) while the verdict is `healthy` — proof the scheduler is alive again — which zeroes `attempts`, `unhealthy`, and `injectedTriggers`, and rebases the action-count baseline.

Backoff between heal attempts on the same schedule is exponential: `min(backoffBaseMs × 2^attempts, backoffCapMs)` (30s base, capped at 5 minutes) — a fixed internal constant, not env-configurable.

---

## Observe vs. Enforce Modes

`SCHEDULE_WATCHDOG_MODE` controls whether the watchdog is allowed to act:

- **`observe`** — never mutates a schedule. A `stale` or `NOT_FOUND` schedule is recorded as `observedUnhealthy` in the database and surfaces in the admin UI, but nothing is created, updated, or triggered. Use this to validate detection in a new environment — confirm the watchdog isn't flagging healthy schedules as stale — before it's trusted to act.
- **`enforce`** (default) — runs the full heal ladder described above.

Recommended rollout: deploy with `observe` first, watch the Schedules tab for a normal operating period to confirm no false positives (tune `SCHEDULE_WATCHDOG_MIN_AGE` / `SCHEDULE_WATCHDOG_MISSED_FIRINGS` if the schedule mix needs a different grace window), then flip to `enforce`.

---

## State Persistence

Each app persists watchdog state in its own `watchdog_heal_state` table (Provider: `apps/provider/drizzle/0023_spotty_whistler.sql`; Middleman: `apps/middleman/drizzle/0017_blue_the_santerians.sql`) — one row per `scheduleId`, upserted:

| Column | Meaning |
|--------|---------|
| `schedule_id` | Primary key — matches the Temporal schedule ID. |
| `attempts` | Definitive heal actions taken since the ladder last reset. Drives the breaker. |
| `injected_triggers` | Compensating `trigger()` calls the watchdog has issued since the last baseline. Written *before* the trigger fires (write-ahead) — never an undercount. |
| `last_heal_trigger_at` | Timestamp of the most recent injected trigger. |
| `last_action_count` | Baseline snapshot of Temporal's `numActionsTaken`, used to detect autonomous fires. |
| `unhealthy` | Breaker tripped — `attempts` reached `SCHEDULE_WATCHDOG_MAX_HEAL_ATTEMPTS`. |
| `observed_unhealthy` | Set in `observe` mode (or on `NOT_FOUND` in `observe` mode) instead of acting. |

The write-ahead ordering — persisting a counter before performing the effect it counts — is the core safety property: `attempts` and `injected_triggers` can only ever be equal to or greater than what actually happened, never less, even across a crash mid-action.

The admin **Workflows UI** surfaces this state directly. `mapScheduleToHealth()` (in `workflowView.ts`) combines a Temporal `ScheduleSummary` with its `watchdog_heal_state` row into a `ScheduleHealthRow`, using this precedence: `paused` wins outright; otherwise `unhealthy` if either the breaker tripped or the state was observed-unhealthy; otherwise `stale` if `attempts > 0`; otherwise `healthy`. The Schedules tab renders this as a health badge per schedule, a **Heal attempts** column, and an expandable panel of recent fires with lag and run status. See [Provider Workflows](../provider/workflows.md) and [Middleman Workflows](../middleman/workflows.md) for the full UI walkthrough.

---

## Configuration

All variables are read per-process by `parseWatchdogConfig()`; an unset or invalid value logs a warning and falls back to the default rather than throwing. They're defined once at the repo root (`.env.sample`), mirrored into each app's compose env (`docker-compose/apps/provider/.env.sample`, `docker-compose/apps/middleman/.env.sample`), and selectively forwarded into the workflow pods by each app's Tiltfile (`k8s/apps/provider-workflows/Tiltfile`, `k8s/apps/middleman-workflows/Tiltfile`) — only variables actually set in the environment are injected, so anything left unset falls back to the code default rather than an empty string.

| Env var | Default | Meaning |
|---------|---------|---------|
| `SCHEDULE_WATCHDOG_ENABLED` | `true` | Enables the watchdog for this worker process. When `false`, no watchdog is instantiated and no schedules are monitored. |
| `SCHEDULE_WATCHDOG_MODE` | `enforce` | `observe` (log/record only) or `enforce` (runs the heal ladder). |
| `SCHEDULE_WATCHDOG_TICK` | `30s` | Interval between watchdog ticks. |
| `SCHEDULE_WATCHDOG_MIN_AGE` | `3m` | Grace period after a schedule's creation during which it's always considered healthy, regardless of firing history. |
| `SCHEDULE_WATCHDOG_MISSED_FIRINGS` | `5` | Number of missed intervals tolerated before a schedule is considered stale (feeds the `grace` calculation). |
| `SCHEDULE_WATCHDOG_MAX_HEAL_ATTEMPTS` | `5` | Attempts allowed before the breaker trips and the schedule is marked `unhealthy`. |
| `SCHEDULE_WATCHDOG_RECREATE_AFTER` | `2` | Attempts of in-place `update()` healing before escalating to reconcile + inject a compensating trigger. |

A few bounds used inside the heal loop are fixed constants rather than env-configurable — the grace window floor/ceiling (90s / 600s), the heal-attempt backoff base/cap (30s / 5m), and the `describe()` RPC deadline (5s). They're intentionally not exposed to keep the tuning surface small; change them in `parseWatchdogConfig()` if a deployment genuinely needs different bounds.

---

## Operational Notes

- **Schedule shows `stale` in `observe` mode** — nothing has been mutated; this is informational. Confirm the underlying Temporal server/worker are actually healthy, then either let it self-resolve on the next autonomous fire or flip that environment to `enforce`.
- **Schedule shows `stale` (`attempts > 0`) in `enforce` mode** — the watchdog is actively healing; `attempts` should return to 0 once the schedule fires on its own again. If `attempts` keeps climbing tick over tick, check worker connectivity to the Temporal server and whether the target workflow itself is failing to start.
- **Schedule shows `unhealthy`** — either the heal breaker tripped (`attempts` reached `SCHEDULE_WATCHDOG_MAX_HEAL_ATTEMPTS`) or the schedule was `NOT_FOUND` while running in `observe` mode. This is page-worthy: investigate Temporal server/namespace health and worker logs. There's no manual "clear" button — the ladder resets automatically the next time an autonomous fire is observed, so fixing the root cause and letting (or manually triggering) one successful firing is what recovers it.
- **`unknown` verdicts logged repeatedly** — usually a clock skew or a missing `createdAt`/`recentActions` timestamp from the SDK. Treat it as a signal to check clock sync between the worker and the Temporal server rather than a schedule problem.
