import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/provider/schema'
import Keys from '@/lib/dal/keys'
import Services from "@/lib/dal/services";
import Settings from "@/lib/dal/settings";
import Transactions from "@/lib/dal/transactions";
import Delegators from "@/lib/dal/delegators";
import NotificationChannels from "@/lib/dal/notificationChannels";

export default class DAL {
  logger: Logger

  dbClient: DBClient<typeof schema> | null = null

  keys: Keys
  services: Services
  settings: Settings
  transactions: Transactions
  delegators: Delegators
  notificationChannels: NotificationChannels

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
    this.keys = new Keys(dbClient, logger.child({ context: 'Keys' }))
    this.services = new Services(dbClient, logger.child({ context: 'Services' }))
    this.settings = new Settings(dbClient, logger.child({ context: 'Settings' }))
    this.transactions = new Transactions(dbClient, logger.child({ context: 'Transactions' }))
    this.delegators = new Delegators(dbClient, logger.child({ context: 'Delegators' }))
    this.notificationChannels = new NotificationChannels(dbClient, logger.child({ context: 'NotificationChannels' }))
  }

  // add any common queries below
}
