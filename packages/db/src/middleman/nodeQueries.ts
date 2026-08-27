import { and, eq, inArray, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { nodesTable } from './schema'

// Loose over the schema generic: only the query-builder surface is used here,
// and both apps pass a fully-typed `NodePgDatabase<MiddlemanSchema>` at the
// call site.
type Db = NodePgDatabase<Record<string, unknown>>

export interface SumStakeAmountOptions {
  /**
   * Restrict to nodes created by this user identity.
   *
   * Required, not optional: the addresses come from a client-supplied payload,
   * so an unscoped sum totals whatever suppliers the caller names, including
   * another account's. Making the safe form the only form means a future caller
   * cannot omit it silently.
   */
  createdBy: string
}

/**
 * Shared middleman node queries, parameterized by the drizzle `db` client.
 *
 * The SQL semantics here are the single source of truth for BOTH the middleman
 * app and its Temporal worker; each app's `nodes` DAL is a thin wrapper that
 * binds its own client.
 */
export function createNodeQueries(db: Db) {
  return {
    /**
     * Total stake (uPOKT) held by the given supplier addresses, or null.
     *
     * Used to record a transaction's amount: MsgUnstakeSupplier carries no
     * amount, so the value has to come from the suppliers' stake while they
     * still hold it.
     *
     * Returns a decimal string, or null — never a partial or zero total.
     * A stored amount is authoritative once written: readers stop falling back
     * to the payload, and the workflow only revisits rows its `storedIsUsable`
     * check rejects. A wrong number is invisible; null degrades to the payload
     * sum, which is a visible unknown. So null is returned when:
     *
     *  - no addresses were given;
     *  - any address has no matching node row, which would silently yield a
     *    partial total;
     *  - any matching row's stakeAmount is zero, which is indistinguishable
     *    from "not yet synced" (imports insert '0' until SupplierStatus fills
     *    it in) -- excluded from the match, so the count falls short;
     *  - any matching row's stakeAmount is non-numeric, or longer than 30
     *    digits (which would overflow the SUM) -- likewise excluded.
     *
     * Duplicate addresses are collapsed before counting, matching the
     * address-keyed dedupe in `extractTransactionUnstakingSuppliers`.
     */
    async sumStakeAmountByAddresses(
      addresses: Array<string>,
      options: SumStakeAmountOptions,
    ): Promise<string | null> {
      const unique = Array.from(new Set(addresses))

      if (!unique.length) return null

      const filters = [
        inArray(nodesTable.address, unique),
        // One purely textual predicate, matching digits with at least one
        // non-zero: '60000000000' and '007' pass, '0' / '000' / '' / 'abc' do
        // not. It does two jobs at once.
        //
        // Non-numeric rows: the column is a varchar with no CHECK, and casting
        // one would raise `invalid input syntax for type numeric` into a caller
        // that only wanted a display value. Deliberately no `::numeric` in the
        // WHERE clause -- Postgres does not guarantee AND-qual evaluation
        // order, so a cast here would rely on the planner filtering first.
        // Aggregates run after filtering, so the SUM's cast is safe.
        //
        // Zero rows: a zero means "not yet synced" (imports seed it, and
        // upsertSupplierStatus writes it whenever the chain payload omits
        // `stake`). Excluding it from the MATCH, not just the sum, is what
        // matters: checking the total for zero afterwards lets a set mixing
        // real stakes with one '0' supplier pass the count check and yield a
        // PARTIAL total that then reads as authoritative forever.
        sql`${nodesTable.stakeAmount} ~ '^0*[1-9][0-9]*$'`,
        // numeric tops out at 131072 integer digits, and stakeAmount is an
        // unbounded varchar fed from transaction payloads, so an absurd value
        // could overflow the SUM. Bounding the length keeps that a null (the
        // row drops out of the match) instead of a raised error.
        sql`length(${nodesTable.stakeAmount}) <= 30`,
      ]

      filters.push(eq(nodesTable.createdBy, options.createdBy))

      const [row] = await db
        .select({
          // ::numeric because stakeAmount is varchar uPOKT and overflows int4.
          // trunc is belt-and-braces only: the digits-only WHERE filter already
          // excludes every fractional value before aggregation, so it can never
          // actually fire. COUNT(*)::int, by contrast, is load-bearing -- an
          // uncast COUNT(*) comes back a string, and '2' !== 2 would make this
          // query always return null.
          total: sql<string | null>`trunc(SUM(${nodesTable.stakeAmount}::numeric))::text`,
          matched: sql<number>`COUNT(*)::int`,
        })
        .from(nodesTable)
        .where(and(...filters))

      if (!row || row.matched !== unique.length) return null
      if (!row.total || row.total === '0') return null

      return row.total
    },
  }
}

export type NodeQueries = ReturnType<typeof createNodeQueries>
