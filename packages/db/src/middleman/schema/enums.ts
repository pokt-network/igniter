import { pgEnum } from 'drizzle-orm/pg-core'
// do not use @/commons since then drizzle kit is not able to find it
// noinspection ES6PreferShortImport
import { enumToPgEnum } from '../../commons'

/**
 * Enumeration representing the different roles a user can have in the system.
 *
 * The `UserRole` defines specific roles that categorize the permissions
 * and responsibilities of a user.
 *
 * Enum Members:
 * - `Admin`: Represents a user with administrative privileges, typically with elevated permissions.
 * - `User`: Represents a regular user with standard permissions.
 * - `Owner`: Represents a user with ownership rights, often having the highest level of authority.
 */
export enum UserRole {
  Admin = 'admin',
  User = 'user',
  Owner = 'owner',
}

/**
 * A constant variable representing a PostgreSQL enumerated type for user roles.
 *
 * This variable is created by converting the `UserRole` enum into a PostgreSQL-compatible enum type
 * using the `pgEnum` function. It is used to define and enforce specific role values in the database schema.
 *
 * @constant
 * @type {Enum}
 */
export const roleEnum = pgEnum('role', enumToPgEnum(UserRole))

/**
 * Enumeration representing various chain identifiers.
 *
 * This enum is used to define distinct identifiers for different chains
 * such as Pocket, PocketBeta, and PocketAlpha. Each identifier is represented
 * as a string.
 */
export enum ChainId {
  Pocket = 'pocket',
  PocketBeta = 'pocket-beta',
  PocketAlpha = 'pocket-alpha',
  PocketTestnet = 'pocket-lego-testnet',
}

/**
 * A PostgreSQL enum representation for chain IDs.
 *
 * This variable represents a PostgreSQL Enum type created using the pgEnum function
 * and the enumToPgEnum utility, converting the ChainId enumeration into a format
 * compatible with PostgreSQL's ENUM type system. It is primarily used to map the
 * ChainId application's enum to a database-level enum type.
 *
 * The enum is named 'chain_ids' in the database and corresponds to the ChainId values.
 */
export const chainIdEnum = pgEnum('chain_ids', enumToPgEnum(ChainId))

/**
 * Represents the types of transactions available in the system.
 *
 * The `TransactionType` enum is used to define the various categories of transactions that can occur.
 * Each enumerated value corresponds to a specific type of transaction operation.
 *
 * Enum values:
 * - `Stake`: Represents a transaction associated with staking.
 * - `Unstake`: Represents a transaction associated with unstaking.
 * - `Upstake`: Represents an additional staking transaction.
 * - `OperationalFunds`: Represents a transaction for operational funding purposes.
 */
export enum TransactionType {
  Stake = 'Stake',
  Unstake = 'Unstake',
  Upstake = 'Upstake',
  OperationalFunds = 'Operational Funds',
}


/**
 * Represents the transaction type as an enumeration mapped to a PostgreSQL enum type.
 * Utilized for defining distinct transaction categories compatible with the PostgreSQL database.
 *
 * The `transactionTypeEnum` variable is constructed using a PostgreSQL enumeration that corresponds
 * directly to the provided `TransactionType` enum. It facilitates an efficient and type-safe
 * representation of transaction types within the application logic and database interactions.
 */
export const transactionTypeEnum = pgEnum(
  'tx_type',
  enumToPgEnum(TransactionType),
)

/**
 * Enum representing the status of a transaction.
 *
 * This enum is used to track the current state of a transaction
 * during its lifecycle.
 *
 * @enum {string}
 * @readonly
 *
 * @property {string} Pending Represents a transaction that is currently in progress and has not yet been completed.
 * @property {string} Success Indicates that the transaction was completed successfully.
 * @property {string} Failure Indicates that the transaction failed to complete successfully.
 * @property {string} NotExecuted Indicates that the transaction was not executed.
 */
export enum TransactionStatus {
  Pending = 'pending',
  Success = 'success',
  Failure = 'failure',
  NotExecuted = 'not_executed',
}

/**
 * Enum representing the different status values for a transaction.
 * This maps the `TransactionStatus` to a PostgreSQL enum named 'tx_status'.
 *
 * transactionStatusEnum is used to define the allowed states for a transaction
 * in the database, ensuring consistency and type safety across application
 * and database interactions.
 */
export const transactionStatusEnum = pgEnum(
  'tx_status',
  enumToPgEnum(TransactionStatus),
)

/**
 * Enum representing the status of a provider.
 *
 * This enumeration describes the different possible states or conditions
 * that a provider might be in, which can be used for status monitoring,
 * health checks, and service management purposes.
 *
 * Members:
 * - Healthy: Indicates that the provider is functioning properly with no issues.
 * - Unhealthy: Indicates that the provider is experiencing issues or is not performing optimally.
 * - Unknown: Indicates that the status of the provider cannot be determined.
 * - Unreachable: Indicates that the provider is not accessible, likely due to network or connectivity issues.
 */
export enum ProviderStatus {
  Healthy = 'healthy',
  Unhealthy = 'unhealthy',
  Unknown = 'unknown',
  Unreachable = 'unreachable',
}

/**
 * Enum representation for the provider status within the application.
 *
 * `providerStatusEnum` maps the `ProviderStatus` values to a PostgreSQL enum type.
 * It is utilized for handling provider status in a consistent and type-safe manner
 * when interacting with the database.
 *
 * The mapping is created using `pgEnum`, which defines the enum type in PostgreSQL
 * and `enumToPgEnum`, which converts the defined `ProviderStatus` to a corresponding
 * database-compatible format.
 *
 * This variable is intended to be used within the database schema definition
 * and for consistency when managing provider status states.
 */
export const providerStatusEnum = pgEnum(
  'provider_status',
  enumToPgEnum(ProviderStatus),
)

/**
 * Enum representing the status of a node in a network or system.
 * This status indicates the current state of a node, such as whether
 * it is actively participating, not participating, or in the process of transitioning.
 *
 * Enum members:
 * - `Staked`: The node is actively participating and staked in the system.
 * - `Unstaked`: The node is not staked and not actively participating in the system.
 * - `Unstaking`: The node is in the process of transitioning from a staked state to an unstaked state.
 */
export enum NodeStatus {
  Staked = 'staked',
  Unstaked = 'unstaked',
  Unstaking = 'unstaking',
}

/**
 * Represents an enumeration for the 'node_status' database enum.
 * This variable is created using the pgEnum utility, which converts
 * the provided NodeStatus enum to a PostgreSQL-compatible enum type.
 *
 * It is used to define valid status values for a node, binding
 * database-level enum constraints with the application's enum representation.
 */
export const nodeStatusEnum = pgEnum('node_status', enumToPgEnum(NodeStatus))

/**
 * Enum representing different types of provider fees.
 *
 * The `ProviderFee` enum is used to define the structure
 * for specifying fee types in the system, providing clarity
 * and preventing arbitrary values.
 *
 * Members:
 * - `UpTo`: Represents a fee type that is capped up to a certain value.
 * - `Fixed`: Represents a fixed fee type where the fee is a constant value.
 */
export enum ProviderFee {
  UpTo = 'up_to',
  Fixed = 'fixed',
}

/**
 * Represents the enumeration for provider fees in the database.
 *
 * This variable is a Postgres enum configuration that maps the `ProviderFee` enumeration
 * into the corresponding Postgres enum type, named 'provider_fee'. It is used to maintain
 * strict data consistency for provider fee values within the application.
 */
export const providerFeeEnum = pgEnum(
  'provider_fee',
  enumToPgEnum(ProviderFee),
)






