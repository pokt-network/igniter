import { temporal } from '@temporalio/proto';
import { optionalTsToDate } from '@temporalio/common/lib/time';
import type { WorkflowExecutionDescription, Client } from '@temporalio/client';

import { PayloadPreview, previewPayloads, safeJsonStringify } from '@/payloadPreview';
import type { WorkflowStatus } from '@/workflowView';

type IHistory = temporal.api.history.v1.IHistory;
type IHistoryEvent = temporal.api.history.v1.IHistoryEvent;
type IFailure = temporal.api.failure.v1.IFailure;

export const TEMPORAL_SCHEDULED_BY_ID = 'TemporalScheduledById';

export type WorkflowFailureView = {
  message: string;
  type: string | null;
  stackTrace: string | null;
  details: PayloadPreview | null;
};

export type WorkflowTaskProblemView = {
  attempt: number;
  cause: string | null;
  message: string | null;
  stackTrace: string | null;
  scheduledAt: string | null;
};

export type ActivityDetailView = {
  scheduledEventId: number;
  activityId: string;
  activityType: string;
  state: 'SCHEDULED' | 'STARTED' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'CANCELED' | 'PENDING';
  pendingState: 'SCHEDULED' | 'STARTED' | 'CANCEL_REQUESTED' | null;
  attempts: number;
  maxAttempts: number | null;
  input: PayloadPreview | null;
  result: PayloadPreview | null;
  failure: { message: string; type: string | null; stackTrace: string | null } | null;
  scheduledAt: string;
  startedAt: string | null;
  closedAt: string | null;
  durationMs: number | null;
  lastHeartbeatAt: string | null;
  nextRetryAt: string | null;
  retryExpiresAt: string | null;
  lastWorkerIdentity: string | null;
};

export type ChildWorkflowDetailView = {
  workflowId: string;
  runId: string | null;
  type: string;
  status: 'INITIATED' | 'STARTED' | 'COMPLETED' | 'FAILED' | 'TERMINATED' | 'TIMED_OUT' | 'CANCELED';
  initiatedAt: string;
  closedAt: string | null;
  durationMs: number | null;
};

export type WorkflowDetailView = {
  workflowId: string;
  runId: string;
  type: string;
  status: WorkflowStatus;
  taskQueue: string;
  historyLength: number;
  startTime: string;
  closeTime: string | null;
  elapsedMs: number;
  parent: { workflowId: string; runId: string } | null;
  nextRunId: string | null;
  scheduledById: string | null;
  searchAttributes: PayloadPreview | null;
  input: PayloadPreview | null;
  output: PayloadPreview | null;
  failure: WorkflowFailureView | null;
  workflowTaskProblem: WorkflowTaskProblemView | null;
  activities: ActivityDetailView[];
  children: ChildWorkflowDetailView[];
  historyError: string | null;
};

type LongLike = { toNumber(): number } | number | null | undefined;

export function longToNumber(value: LongLike): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : value.toNumber();
}

export function protoTimeToIso(time: unknown): string | null {
  const date = optionalTsToDate(time as Parameters<typeof optionalTsToDate>[0]);
  return date ? date.toISOString() : null;
}

function failureParts(failure: IFailure | null | undefined): {
  message: string; type: string | null; stackTrace: string | null;
} | null {
  if (!failure) return null;
  return {
    message: failure.message ?? '<no message>',
    type: failure.applicationFailureInfo?.type ?? null,
    stackTrace: failure.stackTrace ?? null,
  };
}

function enumName(enumObj: Record<string, unknown>, value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const name = (enumObj as Record<number, string>)[value];
  return typeof name === 'string' ? name : String(value);
}

function mapCloseEvents(events: IHistoryEvent[]): {
  output: PayloadPreview | null;
  failure: WorkflowFailureView | null;
  nextRunId: string | null;
} {
  let output: PayloadPreview | null = null;
  let failure: WorkflowFailureView | null = null;
  let nextRunId: string | null = null;

  for (const event of events) {
    const completed = event.workflowExecutionCompletedEventAttributes;
    if (completed) {
      output = previewPayloads(completed.result?.payloads);
      nextRunId = completed.newExecutionRunId || nextRunId;
    }
    const failed = event.workflowExecutionFailedEventAttributes;
    if (failed) {
      const parts = failureParts(failed.failure);
      failure = parts ? { ...parts, details: null } : {
        message: 'Failed', type: null, stackTrace: null, details: null,
      };
      nextRunId = failed.newExecutionRunId || nextRunId;
    }
    const terminated = event.workflowExecutionTerminatedEventAttributes;
    if (terminated) {
      failure = {
        message: terminated.reason || 'Terminated',
        type: null,
        stackTrace: null,
        details: previewPayloads(terminated.details?.payloads),
      };
    }
    const canceled = event.workflowExecutionCanceledEventAttributes;
    if (canceled) {
      failure = {
        message: 'Canceled',
        type: null,
        stackTrace: null,
        details: previewPayloads(canceled.details?.payloads),
      };
    }
    const timedOut = event.workflowExecutionTimedOutEventAttributes;
    if (timedOut) {
      failure = {
        message:
          enumName(temporal.api.enums.v1.RetryState, timedOut.retryState) ?? 'Timed out',
        type: null,
        stackTrace: null,
        details: null,
      };
      nextRunId = timedOut.newExecutionRunId || nextRunId;
    }
    const continued = event.workflowExecutionContinuedAsNewEventAttributes;
    if (continued) {
      nextRunId = continued.newExecutionRunId || nextRunId;
    }
  }
  return { output, failure, nextRunId };
}

function mapWorkflowTaskProblem(
  events: IHistoryEvent[],
  raw: Record<string, unknown>,
): WorkflowTaskProblemView | null {
  const pending = raw.pendingWorkflowTask as
    | { attempt?: number | null; scheduledTime?: unknown }
    | null
    | undefined;
  const lastFailed = [...events]
    .reverse()
    .find((e) => e.workflowTaskFailedEventAttributes);
  const attempt = pending?.attempt ?? 0;
  if (!lastFailed && attempt <= 1) return null;

  const attrs = lastFailed?.workflowTaskFailedEventAttributes;
  const parts = failureParts(attrs?.failure);
  return {
    attempt,
    cause: enumName(temporal.api.enums.v1.WorkflowTaskFailedCause, attrs?.cause),
    message: parts?.message ?? null,
    stackTrace: parts?.stackTrace ?? null,
    scheduledAt: pending?.scheduledTime ? protoTimeToIso(pending.scheduledTime) : null,
  };
}

const PENDING_STATE_NAME: Record<number, ActivityDetailView['pendingState']> = {
  1: 'SCHEDULED',
  2: 'STARTED',
  3: 'CANCEL_REQUESTED',
};

type PendingActivityRaw = {
  activityId?: string | null;
  activityType?: { name?: string | null } | null;
  state?: number | null;
  attempt?: number | null;
  maximumAttempts?: number | null;
  scheduledTime?: unknown;
  expirationTime?: unknown;
  lastHeartbeatTime?: unknown;
  lastWorkerIdentity?: string | null;
  lastFailure?: IFailure | null;
};

function mapActivities(
  events: IHistoryEvent[],
  raw: Record<string, unknown>,
): ActivityDetailView[] {
  const byScheduledId = new Map<number, ActivityDetailView>();
  const timeOf = (e: IHistoryEvent) => protoTimeToIso(e.eventTime);

  for (const event of events) {
    const scheduled = event.activityTaskScheduledEventAttributes;
    if (scheduled) {
      const id = longToNumber(event.eventId);
      if (id === null) continue;
      byScheduledId.set(id, {
        scheduledEventId: id,
        activityId: scheduled.activityId ?? String(id),
        activityType: scheduled.activityType?.name ?? '<unknown>',
        state: 'SCHEDULED',
        pendingState: null,
        attempts: 1,
        maxAttempts: null,
        input: previewPayloads(scheduled.input?.payloads),
        result: null,
        failure: null,
        scheduledAt: timeOf(event) ?? new Date(0).toISOString(),
        startedAt: null,
        closedAt: null,
        durationMs: null,
        lastHeartbeatAt: null,
        nextRetryAt: null,
        retryExpiresAt: null,
        lastWorkerIdentity: null,
      });
      continue;
    }

    const lookup = (id: LongLike) => {
      const n = longToNumber(id);
      return n === null ? undefined : byScheduledId.get(n);
    };

    const started = event.activityTaskStartedEventAttributes;
    if (started) {
      const row = lookup(started.scheduledEventId);
      if (row) {
        row.state = 'STARTED';
        row.startedAt = timeOf(event);
        row.attempts = started.attempt ?? row.attempts;
      }
      continue;
    }

    const close = (
      id: LongLike,
      state: ActivityDetailView['state'],
      patch: Partial<ActivityDetailView>,
    ) => {
      const row = lookup(id);
      if (!row) return;
      row.state = state;
      row.closedAt = timeOf(event);
      Object.assign(row, patch);
      if (row.closedAt && row.scheduledAt) {
        row.durationMs =
          new Date(row.closedAt).getTime() - new Date(row.scheduledAt).getTime();
      }
    };

    const completed = event.activityTaskCompletedEventAttributes;
    if (completed) {
      close(completed.scheduledEventId, 'COMPLETED', {
        result: previewPayloads(completed.result?.payloads),
      });
      continue;
    }
    const failed = event.activityTaskFailedEventAttributes;
    if (failed) {
      close(failed.scheduledEventId, 'FAILED', { failure: failureParts(failed.failure) });
      continue;
    }
    const timedOut = event.activityTaskTimedOutEventAttributes;
    if (timedOut) {
      close(timedOut.scheduledEventId, 'TIMED_OUT', {
        failure: failureParts(timedOut.failure) ?? { message: 'Timed out', type: null, stackTrace: null },
      });
      continue;
    }
    const canceled = event.activityTaskCanceledEventAttributes;
    if (canceled) {
      close(canceled.scheduledEventId, 'CANCELED', {});
    }
  }

  // Merge live pending info (attempt, retry picture) by activityId.
  const pendingList = (raw.pendingActivities ?? []) as PendingActivityRaw[];
  for (const pending of pendingList) {
    // Find all open rows with matching activityId, then pick the latest by scheduledEventId.
    // Temporal allows reusing activityIds across closed and open activities in the same run.
    const matchingRows = [...byScheduledId.values()].filter(
      (r) => r.activityId === (pending.activityId ?? '') && !r.closedAt,
    );
    const row = matchingRows.length > 0
      ? matchingRows.reduce((max, r) => r.scheduledEventId > max.scheduledEventId ? r : max)
      : undefined;
    if (!row) continue;
    row.state = 'PENDING';
    row.pendingState = PENDING_STATE_NAME[pending.state ?? 0] ?? null;
    row.attempts = pending.attempt ?? row.attempts;
    row.maxAttempts =
      pending.maximumAttempts && pending.maximumAttempts > 0 ? pending.maximumAttempts : null;
    row.nextRetryAt = pending.scheduledTime ? protoTimeToIso(pending.scheduledTime) : null;
    row.retryExpiresAt = pending.expirationTime ? protoTimeToIso(pending.expirationTime) : null;
    row.lastHeartbeatAt = pending.lastHeartbeatTime ? protoTimeToIso(pending.lastHeartbeatTime) : null;
    row.lastWorkerIdentity = pending.lastWorkerIdentity ?? null;
    const pendingFailure = failureParts(pending.lastFailure);
    if (pendingFailure) row.failure = pendingFailure;
  }

  return [...byScheduledId.values()].sort((a, b) => a.scheduledEventId - b.scheduledEventId);
}

function mapChildren(events: IHistoryEvent[]): ChildWorkflowDetailView[] {
  const byInitiatedId = new Map<number, ChildWorkflowDetailView>();
  const timeOf = (e: IHistoryEvent) => protoTimeToIso(e.eventTime);

  for (const event of events) {
    const initiated = event.startChildWorkflowExecutionInitiatedEventAttributes;
    if (initiated) {
      const id = longToNumber(event.eventId);
      if (id === null) continue;
      byInitiatedId.set(id, {
        workflowId: initiated.workflowId ?? '<unknown>',
        runId: null,
        type: initiated.workflowType?.name ?? '<unknown>',
        status: 'INITIATED',
        initiatedAt: timeOf(event) ?? new Date(0).toISOString(),
        closedAt: null,
        durationMs: null,
      });
      continue;
    }

    const lookup = (id: LongLike) => {
      const n = longToNumber(id);
      return n === null ? undefined : byInitiatedId.get(n);
    };
    const close = (id: LongLike, status: ChildWorkflowDetailView['status']) => {
      const row = lookup(id);
      if (!row) return;
      row.status = status;
      row.closedAt = timeOf(event);
      if (row.closedAt) {
        row.durationMs =
          new Date(row.closedAt).getTime() - new Date(row.initiatedAt).getTime();
      }
    };

    const started = event.childWorkflowExecutionStartedEventAttributes;
    if (started) {
      const row = lookup(started.initiatedEventId);
      if (row) {
        row.status = 'STARTED';
        row.runId = started.workflowExecution?.runId ?? null;
      }
      continue;
    }
    if (event.childWorkflowExecutionCompletedEventAttributes) {
      close(event.childWorkflowExecutionCompletedEventAttributes.initiatedEventId, 'COMPLETED');
      continue;
    }
    if (event.childWorkflowExecutionFailedEventAttributes) {
      close(event.childWorkflowExecutionFailedEventAttributes.initiatedEventId, 'FAILED');
      continue;
    }
    if (event.childWorkflowExecutionTerminatedEventAttributes) {
      close(event.childWorkflowExecutionTerminatedEventAttributes.initiatedEventId, 'TERMINATED');
      continue;
    }
    if (event.childWorkflowExecutionTimedOutEventAttributes) {
      close(event.childWorkflowExecutionTimedOutEventAttributes.initiatedEventId, 'TIMED_OUT');
      continue;
    }
    if (event.childWorkflowExecutionCanceledEventAttributes) {
      close(event.childWorkflowExecutionCanceledEventAttributes.initiatedEventId, 'CANCELED');
    }
  }

  return [...byInitiatedId.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v);
}

export function mapWorkflowDetail(
  desc: WorkflowExecutionDescription,
  history: IHistory | null,
  historyError: string | null,
  nowMs: number = Date.now(),
): WorkflowDetailView {
  const events = history?.events ?? [];
  const raw = (desc.raw ?? {}) as unknown as Record<string, unknown>;

  const started = events.find((e) => e.workflowExecutionStartedEventAttributes);
  const input = previewPayloads(
    started?.workflowExecutionStartedEventAttributes?.input?.payloads,
  );
  const { output, failure, nextRunId } = mapCloseEvents(events);

  const startMs = desc.startTime.getTime();
  const closeMs = desc.closeTime ? desc.closeTime.getTime() : null;

  const searchAttrs = (desc.searchAttributes ?? {}) as Record<string, unknown[]>;
  const scheduledByRaw = searchAttrs[TEMPORAL_SCHEDULED_BY_ID]?.[0];
  const scheduledById = typeof scheduledByRaw === 'string' ? scheduledByRaw : null;
  const otherAttrs = Object.fromEntries(
    Object.entries(searchAttrs).filter(([k]) => k !== TEMPORAL_SCHEDULED_BY_ID),
  );

  const parent =
    desc.parentExecution?.workflowId && desc.parentExecution?.runId
      ? { workflowId: desc.parentExecution.workflowId, runId: desc.parentExecution.runId }
      : null;

  return {
    workflowId: desc.workflowId,
    runId: desc.runId,
    type: desc.type,
    status: desc.status.name as WorkflowStatus,
    taskQueue: desc.taskQueue,
    historyLength: desc.historyLength,
    startTime: new Date(startMs).toISOString(),
    closeTime: closeMs ? new Date(closeMs).toISOString() : null,
    elapsedMs: Math.max(0, (closeMs ?? nowMs) - startMs),
    parent,
    nextRunId,
    scheduledById,
    searchAttributes:
      Object.keys(otherAttrs).length > 0
        ? previewSearchAttributes(otherAttrs)
        : null,
    input,
    output,
    failure,
    workflowTaskProblem: mapWorkflowTaskProblem(events, raw),
    activities: mapActivities(events, raw),
    children: mapChildren(events),
    historyError,
  };
}

function previewSearchAttributes(attrs: Record<string, unknown[]>): PayloadPreview {
  // Values are already decoded by the SDK; serialize directly.
  const text = safeJsonStringify(attrs);
  return { text, truncated: false, decodeError: null };
}

export async function getWorkflowDetail(
  client: Client,
  workflowId: string,
  runId?: string,
  nowMs: number = Date.now(),
): Promise<WorkflowDetailView> {
  const handle = client.workflow.getHandle(workflowId, runId);
  const desc = await handle.describe();
  let history: IHistory | null = null;
  let historyError: string | null = null;
  try {
    history = await handle.fetchHistory();
  } catch (err) {
    historyError = err instanceof Error ? err.message : String(err);
  }
  return mapWorkflowDetail(desc, history, historyError, nowMs);
}

export async function getWorkflowHistoryJson(
  client: Client,
  workflowId: string,
  runId?: string,
): Promise<string> {
  const handle = client.workflow.getHandle(workflowId, runId);
  const history = await handle.fetchHistory();
  const plain =
    typeof (history as { toJSON?: () => unknown }).toJSON === 'function'
      ? (history as { toJSON: () => unknown }).toJSON()
      : history;
  return safeJsonStringify(plain);
}
