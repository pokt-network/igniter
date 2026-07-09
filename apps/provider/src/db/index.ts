import { getLogger } from '@igniter/logger'
import { getDb as getDbConnection } from '@igniter/db/provider/connection'
import schema from '@igniter/db/provider/schema'
import { DBClient } from '@igniter/db/connection'

const logger = getLogger(['provider', 'db'])

let dbClient: DBClient<typeof schema>

export const getDbClient = () => {
  if (dbClient) {
    return dbClient
  }

  dbClient = getDbConnection(logger)
  return dbClient
}

export const getDb = () => getDbClient().db
