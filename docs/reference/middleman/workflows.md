[< Back to Middleman documentation](../../../apps/middleman/README.md)

# Workflows

The Workflows page is an operator-facing observability and debugging view over the Temporal workflows that power Middleman's background processing — transaction execution, supplier status polling, governance sync, and recovery. Use it to check on in-flight work, investigate a failed run, or confirm a scheduled job is still firing on time.

**Path:** `/admin/workflows` · **Access:** Admin only (the operator/owner account)

<!-- SCREENSHOT: Capture the /admin/workflows page on the Workflows tab, showing the filter row, table with a few rows of different statuses, and the workflow counter. -->
<!-- ![Screenshot: Workflows table](../screenshots/workflows-table.png) -->

---

## Access

The page is served under the admin-only route group and every server action behind it calls `requireAdmin()`, which checks the current user has the `Owner` role. There is currently no separate "admin" role distinct from the instance owner — only the bootstrapped owner account can reach this page.

---

## Tabs

The page has two tabs, **Workflows** and **Schedules**, selected via a `tab` URL query parameter (`?tab=workflows` or `?tab=schedules`) so the current tab survives a page refresh or a shared link. The Schedules tab shows a count badge when one or more schedules are in a `stale` or `unhealthy` state — red if any schedule is `unhealthy`, amber if only `stale`.

---

## Workflows Tab

Lists Temporal workflow executions with filtering, pagination, and a Terminate action for running workflows.

### Filters

| Filter     | Options                                                                                    | Notes                                                                                                                                                                                             |
|------------|--------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Scope**  | All / Running                                                                              | Toggle buttons. "Running" restricts to `RUNNING` executions regardless of the Status filter.                                                                                                      |
| **Status** | Any status, Running, Completed, Failed, Terminated, Timed Out, Cancelled, Continued as New | Dropdown.                                                                                                                                                                                         |
| **Type**   | Any type, one of Middleman's known workflow types, or **Other…**                           | Dropdown seeded from Middleman's own workflow type list (below). Selecting **Other…** reveals a free-text input for any workflow type not in the list, debounced 300ms before it updates the URL. |

All filters and pagination state are written to the URL (`scope`, `status`, `type`, `page`, `pageSize`), so changing a filter resets pagination to page 0 and the current view can be bookmarked or shared. A **workflow counter** on the right of the filter row shows the total matching rows.

### Middleman Workflow Types

| Type                         |
|------------------------------|
| `ExecutePendingTransactions` |
| `ExecuteTransaction`         |
| `GovernanceSync`             |
| `ImportSupplierRecovery`     |
| `ProviderStatus`             |
| `SupplierStatus`             |
| `SupplierStatusByRange`      |
| `VerifyPendingTransactions`  |

### Table Columns

| Column          | Description                                                                                                                                                   |
|-----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Workflow ID** | Truncated, monospaced, links to the [detail page](#detail-page). A copy icon next to it copies the full ID.                                                   |
| **Type**        | The workflow type name.                                                                                                                                       |
| **Status**      | Status badge — see [Statuses](#statuses) below.                                                                                                               |
| **Started**     | Start time, localized.                                                                                                                                        |
| **Elapsed**     | Time since start (running) or start-to-close duration (terminal). Shown in milliseconds under 1 second, then seconds/minutes/hours/days as it grows.          |
| **Origin**      | A `scheduled` badge when the run was started by a Temporal Schedule (hover to see the schedule ID). Empty for manually or programmatically started workflows. |
| *(actions)*     | An arrow button opens the detail page. A **Terminate** button appears only for `RUNNING` rows.                                                                |

### Statuses

| Status                          | Badge             |
|---------------------------------|-------------------|
| `RUNNING`                       | Info (blue)       |
| `COMPLETED`                     | Success (green)   |
| `FAILED`, `TERMINATED`          | Destructive (red) |
| `TIMED_OUT`                     | Warning (amber)   |
| `CANCELLED`, `CONTINUED_AS_NEW` | Secondary (gray)  |

### Filtering by Schedule

Clicking **View runs** from the Schedules tab (see below) cross-filters this table to the runs started by that schedule ID, shown as a dismissible blue pill in the filter row ("Schedule `<id>`" with a **✕** to clear it).

### Terminate

Terminating is only offered for `RUNNING` workflows. It opens a confirmation dialog warning that the action cannot be undone and — for transaction workflows — that the affected transaction row self-recovers and gets re-dispatched, but should only be terminated with an understanding of the impact. On confirm, the table refetches.

---

## Schedules Tab

A read-only view of Temporal Schedule health, sourced from the schedule list plus watchdog heal state recorded by the [schedule self-heal watchdog](../schedule-watchdog.md). This tab surfaces what the watchdog has already flagged — it does not run any checks itself.

<!-- SCREENSHOT: Capture the /admin/workflows?tab=schedules page showing the schedule health table with at least one expanded "Recent fires" row. -->
<!-- ![Screenshot: Schedule health table](../screenshots/workflows-schedules-tab.png) -->

### Table Columns

| Column        | Description                                                                                                                                                        |
|---------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| *(expand)*    | Toggles the **Recent fires** panel for that schedule.                                                                                                              |
| **Schedule**  | The schedule ID, monospaced.                                                                                                                                       |
| **State**     | Health badge — see below.                                                                                                                                          |
| **Last fire** | Relative time of the most recent action (hover for the absolute timestamp).                                                                                        |
| **Next fire** | Relative time of the next scheduled action.                                                                                                                        |
| **Unstuck**   | Number of times the watchdog has attempted to heal this schedule. Highlighted amber when greater than 0.                                                           |
| **Recreated** | Number of times the watchdog recreated this schedule after finding it `NOT_FOUND`. Highlighted amber when greater than 0, hover for the last recreation timestamp. |
| **Note**      | The schedule's Temporal-native note field, if set (truncated with a tooltip for the full text).                                                                    |
| *(view runs)* | Cross-filters the Workflows tab to this schedule's runs (see [Filtering by Schedule](#filtering-by-schedule)).                                                     |

### Health States

| State         | Meaning                                                                                                                                                                   |
|---------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **healthy**   | No unstuck actions recorded and the schedule is not paused.                                                                                                               |
| **paused**    | The Temporal Schedule is paused. Takes precedence over the other states.                                                                                                  |
| **stale**     | The watchdog has recorded one or more unstuck actions, but the schedule isn't currently flagged unhealthy — a sign it's recovering or the watchdog previously intervened. |
| **unhealthy** | The watchdog currently considers this schedule unhealthy (missed its expected fire window).                                                                               |

### Recent Fires

Expanding a schedule row loads its most recent runs and shows a compact table:

| Column       | Description                                                                                                                                                                    |
|--------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Fired**    | Relative time the action was taken (hover for the absolute timestamp).                                                                                                         |
| **Lag**      | Delay between the scheduled time and when Temporal actually took the action, in ms or s. Highlighted amber above **30 seconds** of lag.                                        |
| **Workflow** | Link to the workflow's detail page.                                                                                                                                            |
| **Status**   | The run's current status badge, resolved by matching the fire's workflow ID against a query of that schedule's recent runs. Shows `…` while loading, `—` if no match is found. |

Fires are listed newest first.

---

## Detail Page

**Path:** `/admin/workflows/<workflowId>?runId=<runId>`

<!-- SCREENSHOT: Capture a workflow detail page for a completed workflow, showing the header, details grid, and an expanded Input/Output section. -->
<!-- ![Screenshot: Workflow detail page](../screenshots/workflow-detail.png) -->

### Header

A breadcrumb (`Workflows / [parent workflow ID /] <type>`) sits above the page heading. If the workflow was started as a child of another workflow, the parent's workflow ID appears as a link in the breadcrumb. The heading shows the workflow type, a status badge, and the full workflow ID with a copy button. Header actions:

| Action                      | Description                                                                                             |
|-----------------------------|---------------------------------------------------------------------------------------------------------|
| **Refresh**                 | Manually refetches the detail query.                                                                    |
| **Download history (JSON)** | Downloads the full Temporal event history as a `.json` file, named `<workflowId>.<runId>.history.json`. |
| **Terminate**               | Only shown for `RUNNING` workflows — same confirmation dialog and warning as the table view.            |

While the workflow is `RUNNING`, the detail query auto-refreshes every 10 seconds; it stops refreshing once the workflow reaches a terminal status. If a background refresh fails but a previous successful load is still cached, the page keeps showing the stale data with a "last updated … — refresh failing" note instead of blanking out.

### Details Grid

| Field          | Description                                                                     |
|----------------|---------------------------------------------------------------------------------|
| Run ID         | Monospaced, with copy button.                                                   |
| Task queue     | The Temporal task queue this execution ran on.                                  |
| Started        | Absolute start time.                                                            |
| Closed         | Absolute close time, or `—` while running.                                      |
| Elapsed        | Same formatting as the table's Elapsed column.                                  |
| History length | Number of events in the workflow's Temporal history.                            |
| Scheduled by   | Only shown when the run was schedule-started — links back to the Schedules tab. |
| Parent         | Only shown for child workflows — links to the parent's detail page.             |
| Next run       | Only shown when the workflow continued-as-new — links to the successor run.     |

Below the grid, a collapsible **Search attributes** block (via the shared payload block component) shows any custom search attributes attached to the workflow, excluding the internal schedule-origin attribute (which is surfaced separately as "Scheduled by").

### Banners

| Banner                            | Condition                                                                                                                                                                                                                                                                                                                                                                                     |
|-----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Workflow task failing** (amber) | Shown only while the workflow is `RUNNING` and its most recent workflow task attempt failed or is retrying — the classic signature of a stuck workflow (e.g. a non-deterministic replay error). Shows the attempt number, cause, message, and stack trace. Does not reappear on a workflow that later recovered and closed, even though the underlying failed-task event is still in history. |
| **Failure** (red)                 | Shown when the workflow closed with a failure, was terminated, canceled, or timed out. Shows the failure type/message, stack trace, and any details payload.                                                                                                                                                                                                                                  |
| **History unavailable** (amber)   | Shown when Temporal's history fetch failed even though the workflow's summary (`describe()`) loaded. Header and details grid still work; Activities, Input/Output, and Children are hidden since they're derived from history.                                                                                                                                                                |

### Input / Output

Two collapsible payload blocks (expanded by default), each with a copy button, a truncation flag if the payload exceeded **32KB**, and a decode-failure flag if the payload couldn't be deserialized (falls back to showing raw bytes as base64). JSON-shaped payloads get lightweight syntax highlighting. If the workflow has no result yet, it shows "Still running — no result yet." instead of an empty Output block.

### Activities

A table of every activity scheduled during the run, in schedule order:

| Column       | Description                                                                           |
|--------------|---------------------------------------------------------------------------------------|
| *(expand)*   | Toggles a detail panel with input/result/failure payloads.                            |
| **#**        | Position in the activity sequence.                                                    |
| **Activity** | Activity type name.                                                                   |
| **Status**   | `SCHEDULED`, `STARTED`, `COMPLETED`, `FAILED`, `TIMED_OUT`, `CANCELED`, or `PENDING`. |
| **Attempts** | `<current> / <max>` (max shown as `∞` when the activity has no attempt limit).        |
| **Started**  | Relative time, or `—` if not yet started.                                             |
| **Duration** | Elapsed time for closed activities.                                                   |

For a `PENDING` activity — one that's mid-retry — the expanded panel shows the pending sub-state (`SCHEDULED`, `STARTED`, or `CANCEL_REQUESTED`), the next retry time, when retries expire, the last heartbeat time, and the identity of the worker that last picked it up. This is the primary place to see *why* an activity hasn't completed yet.

### Child Workflows

If the workflow spawned any children, a table lists each one's workflow ID (linking to its own detail page), type, status badge, when it was initiated, and its duration. Only shown when there's at least one child.

---

## Troubleshooting

### A workflow looks stuck (`RUNNING` for far longer than expected)

1. Open its detail page and check for the amber **Workflow task failing** banner — this means the workflow's own execution logic is erroring on every attempt (commonly a non-deterministic code change or an unhandled exception in workflow code, not activity code). The stack trace under the banner is the direct cause.
2. If there's no task-failing banner, check the **Activities** section for a `PENDING` row — expand it to see the retry schedule, next retry time, and last worker identity. A long gap since the last heartbeat with no recent worker identity often means the worker process handling that task queue is down or was redeployed without draining in-flight activities.
3. As a last resort, **Terminate** the workflow. For transaction-related workflow types, the underlying transaction row self-recovers and gets re-dispatched by the recovery machinery — read the confirmation dialog's warning before doing this on anything you don't fully understand.

### A run failed and you need to know why

Open its detail page. The **Failure** banner has the message, type, and stack trace. If the failure came from an activity rather than the workflow itself, expand the failing row in **Activities** — its own failure payload usually has more specific detail (the underlying error from the activity code) than the workflow-level failure summary. **Download history (JSON)** if you need the full raw Temporal event log for deeper forensics.

### A schedule doesn't seem to be firing

Check the Schedules tab. A `paused` state means someone (or something) paused the Temporal Schedule directly — this page doesn't manage pause/resume, so check the Temporal Web UI or CLI for that. A `stale` or `unhealthy` state means the [watchdog](../schedule-watchdog.md) has already detected and is compensating for a missed fire — expand **Recent fires** to see the actual lag on recent actions, and use **View runs** to jump to the Workflows tab filtered to that schedule's history to check whether the injected recovery runs are completing.

---

**See also:** [Overview](./overview.md) · [Transactions](./transactions.md)
