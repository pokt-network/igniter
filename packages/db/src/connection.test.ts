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

  it('summarizes an array param longer than 50 items, and keeps a short one whole', () => {
    const ids = Array.from({ length: 2385 }, (_, i) => `pokt1supplier${i}`)
    const logged = safeQueryParams('select * from "analytics_supplier_day" where "supplier_id" = any($1) and "day" = $2', [ids, '2026-10-20']) as unknown[]
    expect(logged[0]).toBe('[2385 items: pokt1supplier0, pokt1supplier1, pokt1supplier2 …]')
    expect(logged[1]).toBe('2026-10-20')
    const fifty = ids.slice(0, 50)
    expect((safeQueryParams('select 1 where $1', [fifty]) as unknown[])[0]).toBe(fifty)
    expect((safeQueryParams('select 1 where $1', [ids.slice(0, 51)]) as unknown[])[0]).toBe('[51 items: pokt1supplier0, pokt1supplier1, pokt1supplier2 …]')
  })

  it('does not treat a table whose name only contains "transactions" as sensitive', () => {
    expect(safeQueryParams('select * from "transactions_archive" where "id" = $1', [1])).toEqual([1])
  })
})
