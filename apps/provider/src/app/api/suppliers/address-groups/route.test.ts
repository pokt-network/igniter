jest.mock('server-only', () => ({}))

import { REQUEST_IDENTITY_HEADER } from '@igniter/commons/constants'

// The signature check is not under test here: the caller is delegator-a.
jest.mock('@/lib/utils/routes', () => ({
  ensureApplicationIsBootstrapped: async () => undefined,
  validateRequestSignature: async (request: Request) => ({
    delegator: { identity: 'delegator-a', name: 'A' },
    data: await request.json(),
  }),
}))

const where = jest.fn().mockResolvedValue([])
jest.mock('@/db', () => ({
  getDbClient: () => ({
    db: { select: () => ({ from: () => ({ innerJoin: () => ({ where }) }) }) },
  }),
}))

import { POST } from './route'

// Flattens a drizzle condition into the column names and bound values it holds.
function conditionTerms(node: unknown, seen = new Set<unknown>()): string[] {
  if (node === null || typeof node !== 'object' || seen.has(node)) return []
  seen.add(node)
  if (Array.isArray(node)) return node.flatMap((v) => conditionTerms(v, seen))
  const obj = node as Record<string, unknown>
  const terms: string[] = []
  if (typeof obj.name === 'string' && 'table' in obj) terms.push(obj.name)
  if ('value' in obj && (typeof obj.value === 'string')) terms.push(obj.value)
  if (Array.isArray(obj.value)) terms.push(...obj.value.flatMap((v) => (typeof v === 'string' ? [v] : conditionTerms(v, seen))))
  if (Array.isArray(obj.queryChunks)) terms.push(...obj.queryChunks.flatMap((c) => conditionTerms(c, seen)))
  return terms
}

it("POST /api/suppliers/address-groups only looks up the caller's own suppliers", async () => {
  const response = await POST(new Request('http://localhost/api/suppliers/address-groups', {
    method: 'POST',
    headers: { [REQUEST_IDENTITY_HEADER]: 'delegator-a' },
    body: JSON.stringify({ addresses: ['pokt1a', 'pokt1b'] }),
  }))

  expect(response.status).toBe(200)
  expect(where).toHaveBeenCalledTimes(1)
  const terms = conditionTerms(where.mock.calls[0][0])
  expect(terms).toEqual(expect.arrayContaining(['address', 'pokt1a', 'pokt1b', 'delegator_identity', 'delegator-a']))
})
