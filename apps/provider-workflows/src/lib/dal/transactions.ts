import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/provider/schema'
import { transactionsTable, InsertTransaction } from '@igniter/db/provider/schema'
import type { Logger } from '@igniter/logger'

export default class Transactions {
  logger: Logger
  dbClient: DBClient<typeof schema>

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
  }

  async insert(tx: InsertTransaction): Promise<void> {
    this.logger.debug('insert: Execution Started', { keyAddress: tx.keyAddress, type: tx.type })
    await this.dbClient.db.insert(transactionsTable).values(tx)
    this.logger.debug('insert: Execution Finished', { keyAddress: tx.keyAddress, type: tx.type })
  }
}
