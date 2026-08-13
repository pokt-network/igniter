import { FIELD, REQUEST_ID_HEADER, type RequestContext } from './bindings'

describe('bindings', () => {
  it('uses OTel-compatible snake_case field names', () => {
    expect(FIELD.REQUEST_ID).toBe('request_id')
    expect(FIELD.WORKFLOW_ID).toBe('workflow_id')
    expect(FIELD.RUN_ID).toBe('run_id')
    expect(FIELD.ACTIVITY_ID).toBe('activity_id')
    expect(FIELD.TASK_QUEUE).toBe('task_queue')
  })

  it('reserves trace_id/span_id', () => {
    expect(FIELD.TRACE_ID).toBe('trace_id')
    expect(FIELD.SPAN_ID).toBe('span_id')
  })

  it('standardizes the request-id header as x-request-id', () => {
    expect(REQUEST_ID_HEADER).toBe('x-request-id')
  })

  it('types RequestContext with a request_id', () => {
    const ctx: RequestContext = { request_id: 'abc' }
    expect(ctx.request_id).toBe('abc')
  })
})
