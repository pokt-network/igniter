import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/middleman/schema'
import ApplicationSettings from '@/lib/dal/applicationSettings'
import Provider from '@/lib/dal/provider'
import Node from '@/lib/dal/nodes'
import Transaction from '@/lib/dal/transaction'
import ImportSupplierAttempts from '@/lib/dal/importSupplierAttempts'
import SupplierChanges from '@/lib/dal/supplierChanges'
import Notifications from '@/lib/dal/notifications'

export default class DAL {
  logger: Logger

  dbClient: DBClient<typeof schema> | null = null

  // add more dal's below here
  appSettings: ApplicationSettings
  node: Node
  transaction: Transaction
  provider: Provider
  importSupplierAttempts: ImportSupplierAttempts
  supplierChanges: SupplierChanges
  notifications: Notifications

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
    // Initialize all the DALs here
    this.appSettings = new ApplicationSettings(dbClient, logger)
    this.node = new Node(dbClient, logger)
    this.transaction = new Transaction(dbClient, logger)
    this.provider = new Provider(dbClient, logger)
    this.importSupplierAttempts = new ImportSupplierAttempts(dbClient, logger)
    this.supplierChanges = new SupplierChanges(dbClient, logger)
    this.notifications = new Notifications(dbClient, logger)
  }

  // add any common queries below
}
