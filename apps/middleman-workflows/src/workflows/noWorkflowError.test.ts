import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Structural guard, not a behavioural test.
 *
 * `WorkflowError` is exported by @temporalio/workflow and constructs fine, which
 * is what makes it a trap: it extends plain `Error`, NOT `TemporalFailure`. The
 * SDK fails the whole workflow only for TemporalFailure subclasses; anything else
 * fails the workflow TASK, which then retries forever. A scheduled workflow stuck
 * that way keeps `runningActions` non-empty, so ScheduleOverlapPolicy.SKIP skips
 * every later fire and the schedule silently stops doing its job — mainnet went
 * 3 days without verifying a transaction this way on 2026-08-10.
 *
 * There is no workflow test harness in this repo (@temporalio/testing is not a
 * dependency), so this greps the source instead of exercising the runtime. Throw
 * `ApplicationFailure` to fail a workflow.
 */
describe('workflows never throw WorkflowError', () => {
  const dirs = [
    join(__dirname),
    join(__dirname, '..', '..', '..', 'provider-workflows', 'src', 'workflows'),
  ]

  const files = dirs.flatMap((dir) => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return [] // sibling app not checked out in this context
    }
    return entries
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => join(dir, f))
  })

  it('finds workflow files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s does not construct WorkflowError', (file) => {
    const source = readFileSync(file, 'utf8')
    expect(source).not.toMatch(/new\s+WorkflowError\s*\(/)
  })
})
