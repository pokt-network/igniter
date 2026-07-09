import type { Logger } from '@igniter/logger'
import type { DBClient } from '@igniter/db/connection'
import * as schema from '@igniter/db/provider/schema'
import Keys from '@/lib/dal/keys'
import Services from "@/lib/dal/services";
import Settings from "@/lib/dal/settings";
import Transactions from "@/lib/dal/transactions";
import Delegators from "@/lib/dal/delegators";
import NotificationChannels from "@/lib/dal/notificationChannels";
import Watchdog from "@/lib/dal/watchdog";

export default class DAL {
  logger: Logger

  dbClient: DBClient<typeof schema> | null = null

  keys: Keys
  services: Services
  settings: Settings
  transactions: Transactions
  delegators: Delegators
  notificationChannels: NotificationChannels
  watchdog: Watchdog

  constructor(dbClient: DBClient<typeof schema>, logger: Logger) {
    this.logger = logger
    this.dbClient = dbClient
    this.keys = new Keys(dbClient, logger.getChild('Keys'))
    this.services = new Services(dbClient, logger.getChild('Services'))
    this.settings = new Settings(dbClient, logger.getChild('Settings'))
    this.transactions = new Transactions(dbClient, logger.getChild('Transactions'))
    this.delegators = new Delegators(dbClient, logger.getChild('Delegators'))
    this.notificationChannels = new NotificationChannels(dbClient, logger.getChild('NotificationChannels'))
    this.watchdog = new Watchdog(dbClient, logger.getChild('Watchdog'))
  }

  // add any common queries below
}
