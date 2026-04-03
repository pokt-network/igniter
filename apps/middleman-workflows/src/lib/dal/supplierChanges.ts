import { supplierChangesTable } from '@igniter/db/middleman/schema'
import type { InsertSupplierChange } from '@igniter/db/middleman/schema'
import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/middleman/schema'

export default class SupplierChanges {
  logger: Logger
  dbClient: DBClient<typeof schema>

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  async insertChanges(
    nodeId: number,
    changes: Array<Omit<InsertSupplierChange, 'nodeId'>>,
  ): Promise<void> {
    if (changes.length === 0) return

    const rows: InsertSupplierChange[] = changes.map((c) => ({
      ...c,
      nodeId,
    }))

    await this.dbClient.db.insert(supplierChangesTable).values(rows)
  }
}
