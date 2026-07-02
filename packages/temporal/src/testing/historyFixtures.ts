import Long from 'long';
import { defaultPayloadConverter } from '@temporalio/common';
import type { temporal } from '@temporalio/proto';
import type { WorkflowExecutionDescription } from '@temporalio/client';

type IHistoryEvent = temporal.api.history.v1.IHistoryEvent;
type IPayloads = temporal.api.common.v1.IPayloads;

export function longOf(n: number): Long {
  return Long.fromNumber(n);
}

export function ts(ms: number): { seconds: Long; nanos: number } {
  return { seconds: Long.fromNumber(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 };
}

function payloadsOf(values: unknown[] | undefined): IPayloads | undefined {
  if (!values) return undefined;
  return { payloads: values.map((v) => defaultPayloadConverter.toPayload(v)) };
}

export function startedEvent(o: {
  eventId: number; timeMs: number; input?: unknown[];
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    workflowExecutionStartedEventAttributes: { input: payloadsOf(o.input) },
  };
}

export function completedEvent(o: {
  eventId: number; timeMs: number; result?: unknown; newExecutionRunId?: string;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    workflowExecutionCompletedEventAttributes: {
      result: o.result === undefined ? undefined : payloadsOf([o.result]),
      newExecutionRunId: o.newExecutionRunId,
    },
  };
}

export function failedEvent(o: {
  eventId: number; timeMs: number; message: string; type?: string; stackTrace?: string; newExecutionRunId?: string;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    workflowExecutionFailedEventAttributes: {
      failure: {
        message: o.message,
        stackTrace: o.stackTrace,
        applicationFailureInfo: o.type ? { type: o.type } : undefined,
      },
      newExecutionRunId: o.newExecutionRunId,
    },
  };
}

export function terminatedEvent(o: {
  eventId: number; timeMs: number; reason?: string; details?: unknown[];
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    workflowExecutionTerminatedEventAttributes: {
      reason: o.reason,
      details: payloadsOf(o.details),
    },
  };
}

export function canceledEvent(o: {
  eventId: number; timeMs: number; details?: unknown[];
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    workflowExecutionCanceledEventAttributes: { details: payloadsOf(o.details) },
  };
}

export function timedOutEvent(o: {
  eventId: number; timeMs: number; retryState?: number;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    workflowExecutionTimedOutEventAttributes: { retryState: o.retryState ?? 5 },
  };
}

export function continuedAsNewEvent(o: {
  eventId: number; timeMs: number; newExecutionRunId: string;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    workflowExecutionContinuedAsNewEventAttributes: { newExecutionRunId: o.newExecutionRunId },
  };
}

export function workflowTaskFailedEvent(o: {
  eventId: number; timeMs: number; cause?: number; message?: string; stackTrace?: string;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    workflowTaskFailedEventAttributes: {
      cause: o.cause ?? 1,
      failure: o.message ? { message: o.message, stackTrace: o.stackTrace } : undefined,
    },
  };
}

export function activityScheduledEvent(o: {
  eventId: number; timeMs: number; activityId: string; activityType: string; input?: unknown[];
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    activityTaskScheduledEventAttributes: {
      activityId: o.activityId,
      activityType: { name: o.activityType },
      input: payloadsOf(o.input),
    },
  };
}

export function activityStartedEvent(o: {
  eventId: number; timeMs: number; scheduledEventId: number; attempt?: number;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    activityTaskStartedEventAttributes: {
      scheduledEventId: longOf(o.scheduledEventId),
      attempt: o.attempt ?? 1,
    },
  };
}

export function activityCompletedEvent(o: {
  eventId: number; timeMs: number; scheduledEventId: number; result?: unknown;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    activityTaskCompletedEventAttributes: {
      scheduledEventId: longOf(o.scheduledEventId),
      result: o.result === undefined ? undefined : payloadsOf([o.result]),
    },
  };
}

export function activityFailedEvent(o: {
  eventId: number; timeMs: number; scheduledEventId: number; message: string; type?: string; stackTrace?: string;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    activityTaskFailedEventAttributes: {
      scheduledEventId: longOf(o.scheduledEventId),
      failure: {
        message: o.message,
        stackTrace: o.stackTrace,
        applicationFailureInfo: o.type ? { type: o.type } : undefined,
      },
    },
  };
}

export function activityTimedOutEvent(o: {
  eventId: number; timeMs: number; scheduledEventId: number; message?: string;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    activityTaskTimedOutEventAttributes: {
      scheduledEventId: longOf(o.scheduledEventId),
      failure: o.message ? { message: o.message } : undefined,
    },
  };
}

export function pendingActivityInfo(o: {
  activityId: string; activityType: string; state?: number; attempt?: number;
  maximumAttempts?: number; scheduledTimeMs?: number; expirationTimeMs?: number;
  lastHeartbeatMs?: number; lastWorkerIdentity?: string; lastFailureMessage?: string;
}): Record<string, unknown> {
  return {
    activityId: o.activityId,
    activityType: { name: o.activityType },
    state: o.state ?? 1,
    attempt: o.attempt ?? 1,
    maximumAttempts: o.maximumAttempts ?? 0,
    scheduledTime: o.scheduledTimeMs ? ts(o.scheduledTimeMs) : undefined,
    expirationTime: o.expirationTimeMs ? ts(o.expirationTimeMs) : undefined,
    lastHeartbeatTime: o.lastHeartbeatMs ? ts(o.lastHeartbeatMs) : undefined,
    lastWorkerIdentity: o.lastWorkerIdentity,
    lastFailure: o.lastFailureMessage ? { message: o.lastFailureMessage } : undefined,
  };
}

export function childInitiatedEvent(o: {
  eventId: number; timeMs: number; workflowId: string; workflowType: string;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    startChildWorkflowExecutionInitiatedEventAttributes: {
      workflowId: o.workflowId,
      workflowType: { name: o.workflowType },
    },
  };
}

export function childStartedEvent(o: {
  eventId: number; timeMs: number; initiatedEventId: number; runId: string;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    childWorkflowExecutionStartedEventAttributes: {
      initiatedEventId: longOf(o.initiatedEventId),
      workflowExecution: { workflowId: undefined, runId: o.runId },
    },
  };
}

export function childCompletedEvent(o: {
  eventId: number; timeMs: number; initiatedEventId: number;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    childWorkflowExecutionCompletedEventAttributes: {
      initiatedEventId: longOf(o.initiatedEventId),
    },
  };
}

export function childFailedEvent(o: {
  eventId: number; timeMs: number; initiatedEventId: number;
}): IHistoryEvent {
  return {
    eventId: longOf(o.eventId),
    eventTime: ts(o.timeMs),
    childWorkflowExecutionFailedEventAttributes: {
      initiatedEventId: longOf(o.initiatedEventId),
    },
  };
}

export function makeDescription(
  o: Partial<{
    workflowId: string; runId: string; type: string; statusName: string;
    taskQueue: string; historyLength: number; startTime: Date; closeTime: Date | null;
    parent: { workflowId: string; runId: string } | null;
    searchAttributes: Record<string, unknown[]>;
    raw: Record<string, unknown>;
  }> = {},
): WorkflowExecutionDescription {
  return {
    workflowId: o.workflowId ?? 'wf-1',
    runId: o.runId ?? 'run-1',
    type: o.type ?? 'TestWorkflow',
    status: { name: o.statusName ?? 'COMPLETED', code: 0 },
    taskQueue: o.taskQueue ?? 'test-queue',
    historyLength: o.historyLength ?? 10,
    startTime: o.startTime ?? new Date('2026-07-02T10:00:00Z'),
    closeTime: o.closeTime === undefined ? new Date('2026-07-02T10:00:05Z') : o.closeTime ?? undefined,
    parentExecution: o.parent ?? undefined,
    searchAttributes: o.searchAttributes ?? {},
    raw: { workflowExecutionInfo: {}, ...(o.raw ?? {}) },
  } as unknown as WorkflowExecutionDescription;
}
