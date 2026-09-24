import path from 'node:path'
import { bundleWorkflowCode } from '@temporalio/worker'

/**
 * Smoke test for the one failure `tsc` and unit tests cannot see: Temporal bundles the workflow
 * code with webpack into an isolated V8 context at worker start-up, and refuses any Node built-in,
 * `@temporalio/activity`, or a module that drags them in. A workflow file that imports a RUNTIME
 * value from the activities module (as opposed to `import type`) pulls drizzle, pg, node:crypto
 * and node:dns into that bundle, and the worker crash-loops in the cluster while every other
 * check stays green. This test builds the real bundle so that mistake fails here instead.
 */
describe('workflow bundle', () => {
  it('bundles without pulling Node-only modules or the activities module in', async () => {
    const { code } = await bundleWorkflowCode({
      workflowsPath: require.resolve('./index'),
      webpackConfigHook: (config) => {
        config.mode = 'development'
        config.stats = 'errors-only'
        // The worker bundles from dist/, where tsc-alias has already rewritten `@/…` to relative
        // paths. Bundling from src/ here needs the same mapping (tsconfig `paths`: @/* → src/*).
        config.resolve = { ...config.resolve, alias: { ...config.resolve?.alias, '@': path.resolve(__dirname, '..') } }
        return config
      },
    })

    // Webpack would have thrown on a disallowed module; this pins the more specific invariant
    // that the activities entry point itself stays out of the workflow graph.
    expect(code).not.toMatch(/src\/activities\/index\.(ts|js)/)
  }, 120_000)
})
