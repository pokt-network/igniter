import { temporal } from '@temporalio/proto';
import { optionalTsToDate } from '@temporalio/common/lib/time';
import type { WorkflowExecutionDescription } from '@temporalio/client';

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

// Filled in by later tasks.
function mapActivities(_events: IHistoryEvent[], _raw: Record<string, unknown>): ActivityDetailView[] {
  return [];
}
function mapChildren(_events: IHistoryEvent[]): ChildWorkflowDetailView[] {
  return [];
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
