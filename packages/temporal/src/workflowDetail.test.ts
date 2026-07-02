import { mapWorkflowDetail } from '@/workflowDetail';
import {
  activityCompletedEvent, activityFailedEvent, activityScheduledEvent,
  activityStartedEvent, activityTimedOutEvent, pendingActivityInfo,
  canceledEvent, completedEvent, continuedAsNewEvent, failedEvent,
  makeDescription, startedEvent, terminatedEvent, timedOutEvent, ts,
  workflowTaskFailedEvent,
} from '@/testing/historyFixtures';

const NOW = new Date('2026-07-02T10:01:00Z').getTime();

describe('mapWorkflowDetail — workflow level', () => {
  it('maps identity, times, input and output', () => {
    const desc = makeDescription({ statusName: 'COMPLETED' });
    const history = {
      events: [
        startedEvent({ eventId: 1, timeMs: NOW - 5000, input: [{ txId: 9 }] }),
        completedEvent({ eventId: 20, timeMs: NOW - 1000, result: { ok: true } }),
      ],
    };
    const view = mapWorkflowDetail(desc, history, null, NOW);
    expect(view.workflowId).toBe('wf-1');
    expect(view.status).toBe('COMPLETED');
    expect(JSON.parse(view.input!.text)).toEqual({ txId: 9 });
    expect(JSON.parse(view.output!.text)).toEqual({ ok: true });
    expect(view.failure).toBeNull();
    expect(view.historyError).toBeNull();
  });

  it('FAILED: extracts failure chain message/type/stack', () => {
    const desc = makeDescription({ statusName: 'FAILED' });
    const history = {
      events: [
        startedEvent({ eventId: 1, timeMs: NOW - 5000 }),
        failedEvent({
          eventId: 20, timeMs: NOW - 1000,
          message: 'boom', type: 'ApplicationError', stackTrace: 'at foo()',
        }),
      ],
    };
    const view = mapWorkflowDetail(desc, history, null, NOW);
    expect(view.failure).toEqual({
      message: 'boom', type: 'ApplicationError', stackTrace: 'at foo()', details: null,
    });
  });

  it('TERMINATED: uses reason, no stack', () => {
    const desc = makeDescription({ statusName: 'TERMINATED' });
    const history = {
      events: [
        startedEvent({ eventId: 1, timeMs: NOW - 5000 }),
        terminatedEvent({ eventId: 20, timeMs: NOW - 1000, reason: 'Terminated by operator', details: [{ who: 'jorge' }] }),
      ],
    };
    const view = mapWorkflowDetail(desc, history, null, NOW);
    expect(view.failure!.message).toBe('Terminated by operator');
    expect(view.failure!.stackTrace).toBeNull();
    expect(JSON.parse(view.failure!.details!.text)).toEqual({ who: 'jorge' });
  });

  it('CANCELLED: surfaces details payloads', () => {
    const desc = makeDescription({ statusName: 'CANCELLED' });
    const history = {
      events: [
        startedEvent({ eventId: 1, timeMs: NOW - 5000 }),
        canceledEvent({ eventId: 20, timeMs: NOW - 1000, details: ['user-cancel'] }),
      ],
    };
    const view = mapWorkflowDetail(desc, history, null, NOW);
    expect(view.failure!.message).toBe('Canceled');
    expect(JSON.parse(view.failure!.details!.text)).toBe('user-cancel');
  });

  it('TIMED_OUT: surfaces retryState name', () => {
    const desc = makeDescription({ statusName: 'TIMED_OUT' });
    const history = {
      events: [
        startedEvent({ eventId: 1, timeMs: NOW - 5000 }),
        timedOutEvent({ eventId: 20, timeMs: NOW - 1000, retryState: 5 }),
      ],
    };
    const view = mapWorkflowDetail(desc, history, null, NOW);
    expect(view.failure!.message).toContain('RETRY_STATE_');
  });

  it('captures nextRunId from ContinuedAsNew and from retry-chain Failed', () => {
    const descA = makeDescription({ statusName: 'CONTINUED_AS_NEW' });
    const viewA = mapWorkflowDetail(descA, {
      events: [
        startedEvent({ eventId: 1, timeMs: NOW - 5000 }),
        continuedAsNewEvent({ eventId: 20, timeMs: NOW - 1000, newExecutionRunId: 'run-2' }),
      ],
    }, null, NOW);
    expect(viewA.nextRunId).toBe('run-2');

    const descB = makeDescription({ statusName: 'FAILED' });
    const viewB = mapWorkflowDetail(descB, {
      events: [
        startedEvent({ eventId: 1, timeMs: NOW - 5000 }),
        failedEvent({ eventId: 20, timeMs: NOW - 1000, message: 'x', newExecutionRunId: 'run-retry' }),
      ],
    }, null, NOW);
    expect(viewB.nextRunId).toBe('run-retry');
  });

  it('workflowTaskProblem: set from last WorkflowTaskFailed + pendingWorkflowTask', () => {
    const desc = makeDescription({
      statusName: 'RUNNING',
      closeTime: null,
      raw: {
        pendingWorkflowTask: { attempt: 4, scheduledTime: ts(1780000000 * 1000) },
      },
    });
    const history = {
      events: [
        startedEvent({ eventId: 1, timeMs: NOW - 5000 }),
        workflowTaskFailedEvent({ eventId: 7, timeMs: NOW - 3000, cause: 1, message: 'old' }),
        workflowTaskFailedEvent({ eventId: 9, timeMs: NOW - 1000, cause: 23, message: 'nondeterminism!', stackTrace: 'at wf()' }),
      ],
    };
    const view = mapWorkflowDetail(desc, history, null, NOW);
    expect(view.workflowTaskProblem).not.toBeNull();
    expect(view.workflowTaskProblem!.attempt).toBe(4);
    expect(view.workflowTaskProblem!.message).toBe('nondeterminism!');
    expect(view.workflowTaskProblem!.cause).toEqual(expect.any(String));
  });

  it('workflowTaskProblem: null when no failures and attempt <= 1', () => {
    const desc = makeDescription({ statusName: 'RUNNING', closeTime: null, raw: { pendingWorkflowTask: { attempt: 1 } } });
    const view = mapWorkflowDetail(desc, { events: [startedEvent({ eventId: 1, timeMs: NOW - 5000 })] }, null, NOW);
    expect(view.workflowTaskProblem).toBeNull();
  });

  it('parent: null-guards partial parentExecution', () => {
    const desc = makeDescription({ parent: { workflowId: 'parent-1', runId: null as unknown as string } });
    const view = mapWorkflowDetail(desc, { events: [] }, null, NOW);
    expect(view.parent).toBeNull();
  });

  it('scheduledById: reads TemporalScheduledById[0] from searchAttributes', () => {
    const desc = makeDescription({ searchAttributes: { TemporalScheduledById: ['MySchedule-scheduled'] } });
    const view = mapWorkflowDetail(desc, { events: [] }, null, NOW);
    expect(view.scheduledById).toBe('MySchedule-scheduled');
  });

  it('historyError passthrough: header data present, sections empty', () => {
    const desc = makeDescription({ statusName: 'RUNNING', closeTime: null });
    const view = mapWorkflowDetail(desc, null, 'DEADLINE_EXCEEDED', NOW);
    expect(view.historyError).toBe('DEADLINE_EXCEEDED');
    expect(view.activities).toEqual([]);
    expect(view.children).toEqual([]);
    expect(view.input).toBeNull();
  });
});

describe('mapWorkflowDetail — activities', () => {
  const base = (events: unknown[], raw: Record<string, unknown> = {}) =>
    mapWorkflowDetail(
      makeDescription({ statusName: 'RUNNING', closeTime: null, raw }),
      { events: events as never },
      null,
      NOW,
    );

  it('correlates scheduled→started→completed via Long scheduledEventId', () => {
    const view = base([
      startedEvent({ eventId: 1, timeMs: NOW - 60_000 }),
      activityScheduledEvent({ eventId: 5, timeMs: NOW - 50_000, activityId: 'a1', activityType: 'SendTx', input: [{ tx: 1 }] }),
      activityStartedEvent({ eventId: 6, timeMs: NOW - 49_000, scheduledEventId: 5, attempt: 1 }),
      activityCompletedEvent({ eventId: 7, timeMs: NOW - 48_000, scheduledEventId: 5, result: { hash: '0xabc' } }),
    ]);
    expect(view.activities).toHaveLength(1);
    const act = view.activities[0]!;
    expect(act.scheduledEventId).toBe(5);
    expect(act.activityType).toBe('SendTx');
    expect(act.state).toBe('COMPLETED');
    expect(JSON.parse(act.input!.text)).toEqual({ tx: 1 });
    expect(JSON.parse(act.result!.text)).toEqual({ hash: '0xabc' });
    expect(act.durationMs).toBe(2000);
  });

  it('maps failure with stack on FAILED activities', () => {
    const view = base([
      activityScheduledEvent({ eventId: 5, timeMs: NOW - 50_000, activityId: 'a1', activityType: 'SendTx' }),
      activityStartedEvent({ eventId: 6, timeMs: NOW - 49_000, scheduledEventId: 5, attempt: 3 }),
      activityFailedEvent({ eventId: 7, timeMs: NOW - 48_000, scheduledEventId: 5, message: 'rpc down', type: 'RpcError', stackTrace: 'at act()' }),
    ]);
    const act = view.activities[0]!;
    expect(act.state).toBe('FAILED');
    expect(act.attempts).toBe(3);
    expect(act.failure).toEqual({ message: 'rpc down', type: 'RpcError', stackTrace: 'at act()' });
  });

  it('marks TIMED_OUT and open activities', () => {
    const view = base([
      activityScheduledEvent({ eventId: 5, timeMs: NOW - 50_000, activityId: 'a1', activityType: 'A' }),
      activityTimedOutEvent({ eventId: 6, timeMs: NOW - 40_000, scheduledEventId: 5 }),
      activityScheduledEvent({ eventId: 8, timeMs: NOW - 30_000, activityId: 'a2', activityType: 'B' }),
      activityScheduledEvent({ eventId: 10, timeMs: NOW - 20_000, activityId: 'a3', activityType: 'C' }),
      activityStartedEvent({ eventId: 11, timeMs: NOW - 19_000, scheduledEventId: 10 }),
    ]);
    expect(view.activities.map((a) => a.state)).toEqual(['TIMED_OUT', 'SCHEDULED', 'STARTED']);
  });

  it('merges pendingActivities by activityId into PENDING rows with retry picture', () => {
    const view = base(
      [
        activityScheduledEvent({ eventId: 5, timeMs: NOW - 50_000, activityId: 'a1', activityType: 'SendTx' }),
        activityStartedEvent({ eventId: 6, timeMs: NOW - 49_000, scheduledEventId: 5 }),
      ],
      {
        pendingActivities: [
          pendingActivityInfo({
            activityId: 'a1', activityType: 'SendTx', state: 1, attempt: 7,
            maximumAttempts: 10, scheduledTimeMs: NOW + 42_000,
            expirationTimeMs: NOW + 300_000, lastHeartbeatMs: NOW - 5_000,
            lastWorkerIdentity: 'worker-1@pod', lastFailureMessage: 'ECONNREFUSED',
          }),
        ],
      },
    );
    const act = view.activities[0]!;
    expect(act.state).toBe('PENDING');
    expect(act.pendingState).toBe('SCHEDULED');
    expect(act.attempts).toBe(7);
    expect(act.maxAttempts).toBe(10);
    expect(act.nextRetryAt).toBe(new Date(NOW + 42_000).toISOString());
    expect(act.retryExpiresAt).toBe(new Date(NOW + 300_000).toISOString());
    expect(act.lastHeartbeatAt).toBe(new Date(NOW - 5_000).toISOString());
    expect(act.lastWorkerIdentity).toBe('worker-1@pod');
    expect(act.failure!.message).toBe('ECONNREFUSED');
  });

  it('maxAttempts 0 (unlimited) maps to null', () => {
    const view = base(
      [activityScheduledEvent({ eventId: 5, timeMs: NOW - 50_000, activityId: 'a1', activityType: 'A' })],
      { pendingActivities: [pendingActivityInfo({ activityId: 'a1', activityType: 'A', maximumAttempts: 0 })] },
    );
    expect(view.activities[0]!.maxAttempts).toBeNull();
  });

  it('activityId reuse: prefers latest open row when same activityId spans closed+pending', () => {
    const view = base(
      [
        activityScheduledEvent({ eventId: 5, timeMs: NOW - 50_000, activityId: 'a1', activityType: 'A' }),
        activityStartedEvent({ eventId: 6, timeMs: NOW - 49_000, scheduledEventId: 5, attempt: 1 }),
        activityCompletedEvent({ eventId: 7, timeMs: NOW - 48_000, scheduledEventId: 5 }),
        activityScheduledEvent({ eventId: 9, timeMs: NOW - 30_000, activityId: 'a1', activityType: 'A' }),
        activityStartedEvent({ eventId: 10, timeMs: NOW - 29_000, scheduledEventId: 9, attempt: 1 }),
      ],
      {
        pendingActivities: [
          pendingActivityInfo({
            activityId: 'a1', activityType: 'A', state: 2, attempt: 4,
          }),
        ],
      },
    );
    expect(view.activities).toHaveLength(2);
    const closed = view.activities[0]!;
    const pending = view.activities[1]!;
    expect(closed.scheduledEventId).toBe(5);
    expect(closed.state).toBe('COMPLETED');
    expect(closed.attempts).toBe(1);
    expect(pending.scheduledEventId).toBe(9);
    expect(pending.state).toBe('PENDING');
    expect(pending.attempts).toBe(4);
  });
});
