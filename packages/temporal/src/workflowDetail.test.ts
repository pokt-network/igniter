import { mapWorkflowDetail } from '@/workflowDetail';
import {
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
