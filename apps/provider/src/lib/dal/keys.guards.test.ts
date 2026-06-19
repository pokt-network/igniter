/**
 * Lightweight guard tests for buildMigrationFilterConditions / buildExportFilterConditions.
 * These builders don't touch the DB — they return SQL condition arrays, so no DATABASE_URL needed.
 */
import { __test } from './keys'
import type { SQL } from 'drizzle-orm'

/** Extract raw SQL string fragments from a drizzle SQL object via queryChunks. */
function extractSqlText(cond: SQL): string {
  const chunks = cond.queryChunks ?? []
  return chunks
    .map((chunk) => {
      if (typeof chunk === 'string') return chunk
      if (chunk && typeof chunk === 'object' && 'value' in chunk) {
        return String((chunk as { value: unknown }).value)
      }
      // drizzle column: may have columnName
      if (chunk && typeof chunk === 'object' && 'name' in chunk) {
        return String((chunk as { name: unknown }).name)
      }
      return ''
    })
    .join(' ')
}

function serializeConds(conds: SQL[]): string {
  return conds.map(extractSqlText).join(' ')
}

describe('migration filter guards', () => {
  it('always excludes retired keys (isNull(retiredAt))', () => {
    const conds = __test.buildMigrationFilterConditions({ addressGroupId: 1 })
    const serialized = serializeConds(conds)
    expect(serialized).toMatch(/retired_at/i)
  })

  it('excludes retired keys even when no optional filters are set', () => {
    const conds = __test.buildMigrationFilterConditions({})
    const serialized = serializeConds(conds)
    expect(serialized).toMatch(/retired_at/i)
  })
})

describe('export filter guards', () => {
  it('always excludes retired keys (isNull(retiredAt))', () => {
    const conds = __test.buildExportFilterConditions({})
    const serialized = serializeConds(conds)
    expect(serialized).toMatch(/retired_at/i)
  })
})
