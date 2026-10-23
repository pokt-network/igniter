import { safeQueryParams } from './connection'

// What provider-workflows stores in transactions.params for an unstake / return_funds intent:
// the signer's plaintext private key inside a short JSON string (#357).
const PRIVATE_KEY = 'a1'.repeat(32)
const intentParams = JSON.stringify({ kind: 'unstake', params: { signerPrivateKey: PRIVATE_KEY, supplierAddress: 'pokt1xyz' } })

describe('safeQueryParams', () => {
  it.each([
    ['insert', 'insert into "transactions" ("type", "status", "params") values ($1, $2, $3)'],
    ['update', 'update "transactions" set "params" = $1 where "transactions"."id" = $2'],
  ])('redacts every param of a %s on transactions, so a signer key never reaches the log', (_label, query) => {
    for (const params of [intentParams, intentParams + ' '.repeat(300)]) {
      const logged = JSON.stringify(safeQueryParams(query, ['Unstake', 'pending', params]))
      expect(logged).not.toContain(PRIVATE_KEY)
      expect(logged).not.toContain(PRIVATE_KEY.slice(0, 10))
    }
  })

  it('keeps redacting the tables it already covered', () => {
    expect(safeQueryParams('insert into "keys" ("privateKey") values ($1)', ['secret'])).toBe('[redacted: sensitive table]')
  })

  it('still logs params of other tables, truncating only long strings', () => {
    const long = 'x'.repeat(300)
    const logged = safeQueryParams('select * from "nodes" where "address" = $1 and "note" = $2', ['pokt1abc', long]) as unknown[]
    expect(logged[0]).toBe('pokt1abc')
    expect(String(logged[1])).toMatch(/^x{64}…\[truncated 300 chars\]$/)
  })

  it('does not treat a table whose name only contains "transactions" as sensitive', () => {
    expect(safeQueryParams('select * from "transactions_archive" where "id" = $1', [1])).toEqual([1])
  })
})
