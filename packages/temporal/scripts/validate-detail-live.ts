#!/usr/bin/env -S npx tsx

/**
 * Live SDK validation for the packages/temporal workflow-detail SDK assumptions
 * (docs/superpowers/specs/2026-07-02-workflows-ui-redesign-design.md §5/§8.2).
 *
 * Runs against a real `temporal server start-dev` and checks the proto-shape
 * ground rules that the unit fixtures in workflowDetail.test.ts / workflowView.test.ts
 * encode but cannot themselves prove (a hand-built synthetic fixture passes even if
 * the assumption about the real wire shape is wrong): Long eventIds, IPayloads
 * unwrap/round-trip, describe().raw pending* shapes, TemporalScheduledById query
 * support, and schedule recentActions shapes.
 *
 * No worker runs in this script, so activity/child-workflow event shapes are NOT
 * covered here — those need a worker executing real activities, which is unit-fixture
 * + Part 2 localnet-e2e territory (see feedback_temporal_bigint_e2e). This script only
 * exercises what a bare client talking to start-dev can produce: workflow start/input,
 * terminate/failure, and schedule fan-out.
 *
 * Usage (tsx transpiles the source on the fly — no build step needed):
 *   docker run --rm -d --name tw-devtemporal --entrypoint temporal -p 7233:7233 \
 *     temporalio/admin-tools:1.28.1-tctl-1.18.4-cli-1.4.1 \
 *     server start-dev --ip 0.0.0.0 --port 7233 --namespace default
 *   pnpm --filter @igniter/temporal exec tsx scripts/validate-detail-live.ts
 *   docker stop tw-devtemporal
 *
 * TEMPORAL_ADDRESS env var overrides the default localhost:7233.
 */

import { Client, Connection, defaultPayloadConverter } from '@temporalio/client'
import { getWorkflowDetail, getWorkflowHistoryJson } from '../src/workflowDetail'

const ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233'
const NAMESPACE = 'default'
const TASK_QUEUE = 'validate-detail-live'
const RUN_TAG = Date.now()

let passed = 0
let failed = 0
let skipped = 0

function pass(label: string) {
  passed++
  console.log(`PASS: ${label}`)
}
function fail(label: string, detail?: string) {
  failed++
  console.log(`FAIL: ${label}: ${detail}`)
}
function skip(label: string, reason: string) {
  skipped++
  console.log(`SKIP: ${label}: ${reason}`)
}
function info(label: string, detail: string) {
  console.log(`INFO: ${label}: ${detail}`)
}
function assert(label: string, condition: boolean, detail?: string) {
  if (condition) pass(label)
  else fail(label, detail === undefined ? 'assertion failed' : detail)
}

async function waitFor<T>(
  predicate: () => Promise<T | null>,
  { timeoutMs = 30000, intervalMs = 2000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await predicate()
    if (result) return result
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

// Check 4: TemporalScheduledById visibility query support (informational, not FAIL).
async function checkScheduledByQuery(client: Client, label: string, value: string) {
  const escaped = value.replace(/'/g, "''")
  const query = `TemporalScheduledById = '${escaped}'`
  try {
    const iterable = client.workflow.list({ query })
    for await (const _item of iterable) {
      void _item
      break // one page fetch is enough to surface a query-rejection error, if any
    }
    info(`TemporalScheduledById query (${label})`, `SUPPORTED — query="${query}"`)
  } catch (err: any) {
    info(`TemporalScheduledById query (${label})`, `UNSUPPORTED: ${err.message}`)
  }
}

async function main() {
  console.log(`Connecting to Temporal at ${ADDRESS} (namespace=${NAMESPACE})...`)
  const connection = await Connection.connect({ address: ADDRESS })
  const client = new Client({ connection, namespace: NAMESPACE })

  const scheduleId = `validate-detail-live-schedule-${RUN_TAG}`
  const runningWorkflowId = `validate-detail-live-running-${RUN_TAG}`
  const terminateWorkflowId = `validate-detail-live-terminate-${RUN_TAG}`

  try {
    console.log('\n--- Setup: starting probe workflows (no worker; runs stay RUNNING) ---')
    const runningHandle = await client.workflow.start('ValidateNoopWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId: runningWorkflowId,
      args: [{ hello: 'world', count: 42, nested: { ok: true } }],
    })
    info('started', `${runningWorkflowId} / ${runningHandle.firstExecutionRunId}`)

    const terminateHandle = await client.workflow.start('ValidateNoopWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId: terminateWorkflowId,
      args: [{ willBeTerminated: true }],
    })
    info('started', `${terminateWorkflowId} / ${terminateHandle.firstExecutionRunId}`)

    console.log('\n--- Check 1/2: fetchHistory() event + payload shapes ---')
    const history = await runningHandle.fetchHistory()
    const events = history.events || []
    assert('history has events', events.length > 0, `got ${events.length} events`)

    const firstEvent: any = events[0]
    const eventIdIsLongLike =
      !!firstEvent && typeof firstEvent.eventId === 'object' && firstEvent.eventId !== null
        && typeof firstEvent.eventId.toNumber === 'function'
    assert(
      'events[*].eventId is Long-like (has .toNumber), NOT a plain number',
      eventIdIsLongLike && typeof firstEvent.eventId !== 'number',
      `typeof eventId = ${firstEvent && typeof firstEvent.eventId}, value = ${firstEvent && firstEvent.eventId}`,
    )

    const startedEvent: any = events.find((e: any) => e.workflowExecutionStartedEventAttributes)
    assert('WorkflowExecutionStarted event present', !!startedEvent, 'no started event found in history')

    const inputPayloads =
      startedEvent
      && startedEvent.workflowExecutionStartedEventAttributes
      && startedEvent.workflowExecutionStartedEventAttributes.input
      && startedEvent.workflowExecutionStartedEventAttributes.input.payloads
    assert(
      'WorkflowExecutionStarted.input.payloads exists',
      Array.isArray(inputPayloads) && inputPayloads.length > 0,
      `payloads = ${JSON.stringify(inputPayloads)}`,
    )

    if (Array.isArray(inputPayloads) && inputPayloads.length > 0) {
      try {
        const decoded = inputPayloads.map((p: any) => defaultPayloadConverter.fromPayload(p) as any)
        const value: any = decoded.length === 1 ? decoded[0] : decoded
        assert(
          'input round-trips through defaultPayloadConverter.fromPayload',
          !!value && value.hello === 'world' && value.count === 42 && !!value.nested && value.nested.ok === true,
          `decoded = ${JSON.stringify(value)}`,
        )
      } catch (err: any) {
        fail('input round-trips through defaultPayloadConverter.fromPayload', err.message)
      }
    } else {
      skip('input round-trips through defaultPayloadConverter.fromPayload', 'no input payloads to decode')
    }

    console.log('\n--- Check 3: describe().raw pending* shapes (best-effort) ---')
    const runningDesc = await runningHandle.describe()
    const raw: any = runningDesc.raw || {}
    if (raw.pendingWorkflowTask) {
      const pwt = raw.pendingWorkflowTask
      assert(
        'describe().raw.pendingWorkflowTask has expected shape',
        typeof pwt === 'object' && ('state' in pwt) && ('scheduledTime' in pwt || 'attempt' in pwt),
        `pendingWorkflowTask = ${JSON.stringify(pwt)}`,
      )
    } else {
      skip('describe().raw.pendingWorkflowTask shape', 'absent on this describe() call')
    }
    if (Array.isArray(raw.pendingActivities) && raw.pendingActivities.length > 0) {
      const pa = raw.pendingActivities[0]
      assert(
        'describe().raw.pendingActivities[0] has expected shape',
        typeof pa === 'object' && 'activityId' in pa && 'state' in pa,
        `pendingActivities[0] = ${JSON.stringify(pa)}`,
      )
    } else {
      skip('describe().raw.pendingActivities shape', 'no pending activities (script starts no worker/activities)')
    }

    console.log('\n--- Check 4: TemporalScheduledById visibility query support (informational) ---')
    await checkScheduledByQuery(client, 'plain id', `some-schedule-id-${RUN_TAG}`)
    await checkScheduledByQuery(client, 'id with a single quote', `o'brien-${RUN_TAG}`)

    console.log('\n--- Check 5: schedule.describe().info.recentActions shape ---')
    const scheduleHandle = await client.schedule.create({
      scheduleId,
      spec: { intervals: [{ every: '5s' }] },
      action: {
        type: 'startWorkflow',
        workflowType: 'ValidateNoopWorkflow',
        taskQueue: TASK_QUEUE,
      },
    })
    info('schedule created', scheduleId)

    try {
      const fired = await waitFor(async () => {
        const desc = await scheduleHandle.describe()
        return desc.info.recentActions.length > 0 ? desc : null
      }, { timeoutMs: 30000, intervalMs: 2000 })

      if (!fired) {
        fail('schedule produced at least one recentAction within 30s', 'timed out waiting')
      } else {
        const action: any = fired.info.recentActions[0]
        assert(
          'recentActions[*].scheduledAt is a Date',
          action.scheduledAt instanceof Date,
          `scheduledAt = ${action.scheduledAt} (typeof ${typeof action.scheduledAt})`,
        )
        assert(
          'recentActions[*].takenAt is a Date',
          action.takenAt instanceof Date,
          `takenAt = ${action.takenAt} (typeof ${typeof action.takenAt})`,
        )
        assert(
          'recentActions[*].action.workflow.workflowId present',
          !!(action.action && action.action.workflow && action.action.workflow.workflowId),
          `action = ${JSON.stringify(action.action)}`,
        )

        // Cleanup: terminate every run this schedule fired.
        for (const a of fired.info.recentActions as any[]) {
          const wfId = a.action && a.action.workflow && a.action.workflow.workflowId
          const runId = a.action && a.action.workflow && a.action.workflow.firstExecutionRunId
          if (!wfId) continue
          try {
            await client.workflow.getHandle(wfId, runId).terminate('validation cleanup')
          } catch (err: any) {
            info('cleanup terminate (non-fatal)', `${wfId}: ${err.message}`)
          }
        }
      }
    } finally {
      try {
        await scheduleHandle.delete()
        info('schedule deleted', scheduleId)
      } catch (err: any) {
        info('schedule delete failed (non-fatal)', err.message)
      }
    }

    console.log('\n--- Check 6: getWorkflowDetail / getWorkflowHistoryJson serializability ---')
    const detail: any = await getWorkflowDetail(client, runningWorkflowId)
    const expectedKeys = [
      'workflowId', 'runId', 'type', 'status', 'taskQueue', 'historyLength',
      'startTime', 'closeTime', 'elapsedMs', 'parent', 'nextRunId', 'scheduledById',
      'searchAttributes', 'input', 'output', 'failure', 'workflowTaskProblem',
      'activities', 'children', 'historyError',
    ]
    const missingKeys = expectedKeys.filter((k) => !(k in detail))
    assert(
      'getWorkflowDetail() result has expected top-level keys',
      missingKeys.length === 0,
      `missing: ${missingKeys.join(', ')}`,
    )

    try {
      JSON.stringify(detail)
      pass('getWorkflowDetail() result is JSON-serializable (JSON.stringify does not throw)')
    } catch (err: any) {
      fail('getWorkflowDetail() result is JSON-serializable (JSON.stringify does not throw)', err.message)
    }

    try {
      const historyJson = await getWorkflowHistoryJson(client, runningWorkflowId)
      const parsedOk = JSON.parse(historyJson) !== undefined
      assert('getWorkflowHistoryJson() result parses as JSON', parsedOk, 'JSON.parse returned undefined')
    } catch (err: any) {
      fail('getWorkflowHistoryJson() result parses as JSON', err.message)
    }

    console.log('\n--- Check 7: terminate() -> getWorkflowDetail status/failure ---')
    await terminateHandle.terminate('validation')
    const terminatedDetail: any = await getWorkflowDetail(client, terminateWorkflowId)
    assert(
      "status is TERMINATED after handle.terminate('validation')",
      terminatedDetail.status === 'TERMINATED',
      `status = ${terminatedDetail.status}`,
    )
    assert(
      "failure.message === 'validation'",
      !!terminatedDetail.failure && terminatedDetail.failure.message === 'validation',
      `failure = ${JSON.stringify(terminatedDetail.failure)}`,
    )
  } finally {
    console.log('\n--- Cleanup: terminating the still-running probe workflow ---')
    try {
      await client.workflow.getHandle(runningWorkflowId).terminate('validation cleanup')
    } catch (err: any) {
      info('cleanup terminate (non-fatal)', err.message)
    }
    await connection.close()
  }

  console.log(`\n=== ${passed} passed, ${failed} failed, ${skipped} skipped ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack ? err.stack : err)
  process.exit(1)
})
