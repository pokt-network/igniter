[< Back to Provider documentation](../../../apps/provider/README.md)

# Workflows

## What is the Workflows Page?

The Workflows page is a read-only observability and debugging surface for the Temporal workflows that drive Provider operations — staking, unstaking, remediation, governance sync, and transaction execution. It lets an operator inspect what's running, what's failed, and whether the recurring schedules that trigger background work are firing on time.

**How to access:** In the sidebar, navigate to **Workflows** (`/admin/workflows`). The page is restricted to the Owner account — it is not visible to other admin roles.

All filter and tab state lives in the URL query string, so any view — a specific status filter, a workflow type, the Schedules tab, a drill-down into one schedule's runs — can be bookmarked or shared as a link.

The page has two tabs: **Workflows** and **Schedules**.

<!-- SCREENSHOT: Capture /admin/workflows on the Workflows tab with a mix of statuses in the table and the filter bar visible. -->
<!-- ![Screenshot: Workflows page overview](../screenshots/workflows-overview.png) -->

---

## Workflows Tab

Lists individual Temporal workflow executions, most recent first, with filters and pagination.

### Filters

| Filter     | Description                                                                                                                                                                                                                                                                                                                                                                                                                              |
|------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Scope**  | **All** or **Running** — toggle buttons that scope the list to currently running workflows only.                                                                                                                                                                                                                                                                                                                                         |
| **Status** | Any status, or one of: Running, Completed, Failed, Terminated, Timed Out, Cancelled, Continued as New.                                                                                                                                                                                                                                                                                                                                   |
| **Type**   | A dropdown seeded with the known Provider workflow types (`CreateUnstakeIntents`, `ExecutePendingTransactions`, `ExecuteTransaction`, `GovernanceSync`, `SupplierRemediation`, `SupplierRemediationByRange`, `SupplierStatus`, `SupplierStatusByRange`, `SupplierStatusForAddresses`, `VerifyPendingTransactions`). Selecting **Other…** reveals a free-text field for any other type name (useful for workflow types not in this list). |

A counter to the right of the filter bar shows the total number of workflows matching the current filter.

Changing scope, status, or type resets pagination back to the first page.

### Table Columns

| Column          | Description                                                                                                                                                                                      |
|-----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Workflow ID** | The Temporal workflow ID, truncated with a tooltip showing the full value, with a copy button. Click the ID to open the [detail page](#workflow-detail-page).                                    |
| **Type**        | The workflow type name (e.g., `SupplierRemediation`).                                                                                                                                            |
| **Status**      | A badge: Running (info), Completed (success), Failed / Terminated (destructive), Timed Out (warning), other terminal states (secondary).                                                         |
| **Started**     | Local date/time the workflow started.                                                                                                                                                            |
| **Elapsed**     | Time since start (running workflows) or total duration (terminal workflows). Sub-second durations are shown in milliseconds; larger durations roll up through seconds, minutes, hours, and days. |
| **Origin**      | A `scheduled` chip if the workflow was started by a Temporal Schedule, hovering shows the schedule ID. Blank for manually or code-triggered workflows.                                           |
| *(arrow)*       | Opens the workflow detail page.                                                                                                                                                                  |

### Filtering by Schedule

Arriving from the Schedules tab's **View runs** link adds a blue "Schedule `<id>`" pill to the filter row showing which schedule's runs are being displayed. Click the **✕** on the pill to clear it and return to the unfiltered list.

### Terminate a Workflow

Only workflows in the **Running** status show a **Terminate** action.

1. Click **Terminate** on the row.
2. A confirmation dialog appears, warning that this action cannot be undone and may affect an in-flight transaction. Transaction rows self-recover and are re-dispatched after termination, but confirm you understand the impact before proceeding.
3. Confirm to terminate. The table refreshes automatically.

<!-- SCREENSHOT: Capture the Workflows tab filter bar with the type dropdown open, and the Terminate confirmation dialog. -->
<!-- ![Screenshot: Workflows tab filters and terminate dialog](../screenshots/workflows-tab-filters.png) -->

---

## Schedules Tab

Shows the health of every Temporal Schedule registered for this Provider instance — the recurring triggers behind supplier status checks, remediation, and governance sync. Health state and unstuck counts come from the [schedule watchdog](../schedule-watchdog.md), which detects schedules that have stopped firing and attempts to recover them automatically.

This tab is read-only: it surfaces what the watchdog has already observed and acted on, it does not trigger any actions itself.

### Schedule Health Table

| Column | Description |
|--------|-------------|
| **Schedule** | The schedule's Temporal ID. |
| **State** | See [Schedule States](#schedule-states) below. |
| **Last fire** | Relative time since the schedule last triggered a workflow, hover for the exact timestamp. |
| **Next fire** | Relative time until the schedule's next scheduled trigger. |
| **Unstuck** | Number of times the watchdog has attempted to recover this schedule. Highlighted when greater than zero. |
| **Recreated** | Number of times the watchdog recreated this schedule after finding it `NOT_FOUND`. Highlighted when greater than zero, hover for the last recreation timestamp. |
| **Note** | Any operator or system note attached to the schedule, truncated with a tooltip for the full text. |
| *(View runs)* | Jumps to the Workflows tab, filtered to workflows started by this schedule. |

### Schedule States

| State | Meaning |
|-------|---------|
| **healthy** | Firing normally. No unstuck actions recorded. |
| **paused** | The schedule is paused in Temporal — it will not fire until resumed. |
| **stale** | The watchdog has recorded unstuck actions for this schedule. It's actively trying to recover it. |
| **unhealthy** | The watchdog has flagged this schedule as unhealthy — it needs operator attention. |

### Recent Fires

Click the row's expand arrow to reveal the schedule's recent fires:

| Column | Description |
|--------|-------------|
| **Fired** | Relative time the action was taken, hover for the exact timestamp. |
| **Lag** | The delay between when the action was scheduled and when it was actually taken (`takenAt − scheduledAt`). Shown in milliseconds or seconds, highlighted amber when it exceeds 30 seconds. |
| **Workflow** | Link to the resulting workflow's detail page. |
| **Status** | The workflow's current status badge, looked up lazily when the row is expanded. Shows `…` while loading or `—` if not found. |

<!-- SCREENSHOT: Capture the Schedules tab with one row expanded showing recent fires, including at least one amber lag value. -->
<!-- ![Screenshot: Schedules tab with expanded recent fires](../screenshots/schedules-tab-expanded.png) -->

---

## Workflow Detail Page

Navigate to a workflow's detail page by clicking its ID or the row arrow from either tab. URL: `/admin/workflows/<workflowId>?runId=<runId>`.

### Header

- **Breadcrumb** — Workflows / (parent workflow ID, if this is a child workflow) / workflow type.
- **Status badge** and workflow type as the page title.
- **Workflow ID** with a copy button.
- **Refresh** — manually re-fetch the detail.
- **Download history (JSON)** — downloads the full Temporal event history as a JSON file, named `<workflowId>.<runId>.history.json`.
- **Terminate** — shown only while the workflow is `RUNNING`. Same confirmation and in-flight-transaction warning as the [table action](#terminate-a-workflow).

While the workflow is `RUNNING`, the page auto-refreshes every 10 seconds. If a refresh fails, a stale indicator appears next to the status badge showing when the data was last successfully updated.

### Details Grid

| Field | Description |
|-------|-------------|
| **Run ID** | The specific execution's run ID, with a copy button. |
| **Task queue** | The Temporal task queue this workflow runs on. |
| **Started / Closed** | Start timestamp, and close timestamp for terminal workflows. |
| **Elapsed** | Duration so far (running) or total duration (terminal). |
| **History length** | Number of events in the workflow's history. |
| **Scheduled by** | Present only if the workflow was started by a Temporal Schedule — links back to the Schedules tab. |
| **Parent** | Present only for child workflows — links to the parent's detail page. |
| **Next run** | Present only when the workflow continued as a new run — links to that run. |

If the workflow has custom search attributes beyond the schedule-origin one, they appear in a collapsible **Search attributes** block below the grid.

### Stuck-Workflow Banner

If Temporal's workflow task is repeatedly failing (a sign the workflow is stuck retrying the same task), an amber banner appears showing the attempt count, failure cause, and message, with the stack trace available in a collapsible block. This banner is shown only while the workflow is `RUNNING` — a workflow that later recovered or closed will not show it, even though the underlying history event is still present for forensics in the downloaded history JSON.

### Failure Banner

For workflows that ended in failure, termination, cancellation, or timeout, a red banner shows the failure message and type, with the stack trace and any additional details available in collapsible blocks.

### Input / Output

Collapsible payload blocks for the workflow's input and, once available, its result. Each block shows a line count when collapsed, lightweight JSON syntax highlighting when expanded (for payloads that look like JSON), a **Copy** button, and one of two flags when relevant:
- **truncated** — the payload exceeded 32 KB and was cut off.
- **decode failed** — the payload could not be decoded; a fallback raw or base64 representation is shown instead, with the decode error available on hover.

### Activities Table

One row per activity invocation in the workflow's history.

| Column | Description |
|--------|-------------|
| **#** | Sequence number. |
| **Activity** | Activity type name. |
| **Status** | Badge: Completed (success), Failed (destructive), Timed Out (warning), Pending / Scheduled / Started (info), Canceled (secondary). |
| **Attempts** | Attempt count out of the max configured retries (`∞` if unbounded). |
| **Started** | Relative time the activity started. |
| **Duration** | Elapsed time, for closed activities. |

Expand a row to see:
- For **Pending** activities, the retry picture: pending sub-state, next retry time, when retries expire, last heartbeat time, and the worker identity that last picked it up.
- **Input** and **Result** payload blocks (same truncation/decode-error handling as above).
- A **Failure** block if the activity's last attempt failed.

### Child Workflows

If the workflow spawned child workflows, a table lists each one with its ID (linking to its own detail page), type, status badge, when it was initiated, and its duration. Clicking through supports recursive navigation into nested child workflows.

### Error States

| Situation | What you see |
|-----------|--------------|
| **Not found** | The workflow ID doesn't resolve — likely aged out of Temporal's visibility retention window. A retry button is shown. |
| **Load failure** | A generic error with a retry button. |
| **History degraded** | The workflow's summary (`describe()`) loaded but its event history did not. An amber notice explains that activities, input/output, and children are hidden, while header fields remain available. |

<!-- SCREENSHOT: Capture the workflow detail page for a RUNNING workflow with the Activities table showing a PENDING activity expanded, and one with a Failure banner. -->
<!-- ![Screenshot: Workflow detail page](../screenshots/workflow-detail.png) -->

---

## Reading the Page During an Incident

Common debug flows using this page:

- **A workflow seems stuck.** Open its detail page. If the [stuck-workflow banner](#stuck-workflow-banner) is showing, the workflow task is repeatedly failing — the message and stack trace usually point at the underlying cause (a bad activity input, a code bug, a non-retryable error in a loop). Compare the attempt count against how long the workflow has been running.
- **A run failed and you need forensics.** Open the failed workflow's detail page. The [failure banner](#failure-banner) gives the immediate cause. Expand the **Activities** table to find which activity failed and inspect its **Input** and **Failure** blocks. If you need the complete picture, use **Download history (JSON)** to get the raw event log.
- **A schedule doesn't seem to be firing.** Open the **Schedules** tab and check the schedule's **State** and **Last fire** / **Next fire** columns. If it's `stale` or `unhealthy`, the watchdog has already picked it up — check **Unstuck** to see how much recovery activity has happened. Expand **Recent fires** and look for amber **Lag** values, which point at delayed dispatch rather than a fully stopped schedule. Use **View runs** to jump straight to the resulting workflows and check their outcomes.

---

**See also:** [Schedule Watchdog](../schedule-watchdog.md)
