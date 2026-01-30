import { pgEnum } from 'drizzle-orm/pg-core'
// do not use @/commons since then drizzle kit is not able to find it
// noinspection ES6PreferShortImport
import { enumToPgEnum } from '../../commons'

/**
 * Enumeration for defining different user roles within the application.
 *
 * This enum provides a set of pre-defined values to represent
 * specific roles a user can have, serving as a standard for
 * managing permissions and access levels throughout the system.
 *
 * Roles:
 * - Admin: Represents a user with administrative privileges.
 * - User: Represents a standard user with basic access.
 * - Owner: Represents a user who owns or manages certain resources.
 */
export enum UserRole {
  Admin = 'admin',
  User = 'user',
  Owner = 'owner',
}

/**
 * The `roleEnum` variable represents a PostgreSQL enum type created for the "role" field.
 * It maps values from the `UserRole` enumeration to PostgreSQL enum values.
 * This enum is intended to define distinct user roles within the system
 * and to ensure consistent and validated data storage in the database.
 */
export const roleEnum = pgEnum('role', enumToPgEnum(UserRole))

/**
 * Enum representing various chain identifiers.
 *
 * This enum provides a collection of constants used to identify
 * different blockchain ids supported by the application.
 *
 * Keys:
 * - Pocket: Represents the Mainnet chain identifier.
 * - PocketBeta: Represents the Beta Testnet chain identifier.
 * - PocketAlpha: Represents the Alpha Testnet chain identifier.
 */
export enum ChainId {
  Pocket = 'pocket',
  PocketBeta = 'pocket-beta',
  PocketAlpha = 'pocket-alpha',
  PocketTestnet = 'pocket-lego-testnet',
}

/**
 * An enumeration representing chain IDs, created as a PostgreSQL enum type.
 *
 * This variable establishes a mapping between the `chain_ids` PostgreSQL enumeration
 * and the JavaScript enum `ChainId`, enabling seamless integration between the
 * database and the application.
 *
 * The `chainIdEnum` facilitates type-safe interactions with database queries
 * and ensures consistency when referencing chain IDs within the application.
 *
 * Note: The `enumToPgEnum` function is used to convert the `ChainId` enum
 * into a format compatible with the PostgreSQL enumeration.
 */
export const chainIdEnum = pgEnum('chain_ids', enumToPgEnum(ChainId))

/**
 * Enum representing the various states of a key in the workflow.
 *
 * This enum is used to determine the current state of keys, such as their availability,
 * staking status, or if specific actions like staking or unstaking were successful or failed.
 *
 * Each state corresponds to a particular point within the lifecycle of a key.
 */
export enum KeyState {
  Imported = 'imported',
  Available = 'available',
  Delivered = 'delivered',
  Staking = 'staking',
  /**
   *  Misconfigured keys for which the remediation process did not succeed.
   */
  RemediationFailed = 'remediation_failed',
  /**
   *  Keys that are in an unhealthy or risky state and need human attention because an automatic remediation is not possible
   */
  AttentionNeeded = 'attention_needed',
  Staked = 'staked',
  StakeFailed = 'stake_failed',
  Unstaking = 'unstaking',
  Unstaked = 'unstaked',
  MissingStake = 'missing_stake',
}

/**
 * Mapping of KeyState enum values to their human-readable names.
 * This constant provides friendly display names for each key state
 * that can be used in the UI or documentation.
 */
export const KeyStateNameMap: Record<KeyState, string> = Object.freeze({
  [KeyState.Imported]: 'Imported',
  [KeyState.Available]: 'Available',
  [KeyState.Delivered]: 'Delivered',
  [KeyState.Staking]: 'Staking',
  [KeyState.RemediationFailed]: 'Remediation Failed',
  [KeyState.AttentionNeeded]: 'Attention Needed',
  [KeyState.Staked]: 'Staked',
  [KeyState.StakeFailed]: 'Stake Failed',
  [KeyState.Unstaking]: 'Unstaking',
  [KeyState.Unstaked]: 'Unstaked',
  [KeyState.MissingStake]: 'Missing Stake',
});

/**
 * Enum representing the possible states of an address in a database.
 *
 * The `addressStateEnum` variable is derived from the PostgreSQL enum type `address_states`
 * and is mapped to the corresponding JavaScript enum using the `pgEnum` utility.
 *
 * It is used to encapsulate all the possible address states and ensure type safety
 * when interacting with the database*/
export const addressStateEnum = pgEnum('address_states', enumToPgEnum(KeyState))

/**
 * Enum representing types of provider fees.
 *
 * The `ProviderFee` enum specifies the format in which a fee can be applied,
 * offering flexibility for either fixed or variable (up to a certain amount) fee configurations.
 *
 * Members:
 * - `Up*/
export enum ProviderFee {
  UpTo = 'up_to',
  Fixed = 'fixed',
}

/**
 * Represents the enumeration for provider fees in the database.
 *
 * This variable uses `pgEnum` to define the PostgreSQL enumeration type `provider*/
export const providerFeeEnum = pgEnum(
  'provider_fee',
  enumToPgEnum(ProviderFee),
)


/**
 * Enum representing the reasons for remediation history entries.
 *
 * This enumeration is utilized to categorize and identify the specific reasons
 * why a remediation entry was added to the history.
 *
 * - `ServiceMismatch`: Indicates a mismatch in the provided service.
 * - `DelegatorAddressMissing`: Represents a missing delegator address.
 * - `OwnerInitialStake`: Refers to the initial stake provided by the owner.
 * - `SupplierStakeTooLow`: Signifies that the supplier's stake amount is too low (can happen after a slashing).
 * - `SupplierFundsTooLow`: Signifies that the supplier's available funds are too low.
 */
export enum RemediationHistoryEntryReason {
  ServiceMismatch = '1001',
  DelegatorAddressMissing = '1002',
  OwnerInitialStake = '1003',
  SupplierStakeTooLow = '1004',
  SupplierFundsTooLow = '1005',
}

/**
 * Enum representing possible outcomes of a transaction process.
 * Each outcome corresponds to a specific status code.
 *
 * These statuses can be used to identify the result of a transaction operation,
 * including success, various errors, or specific system-level issues.
 *
 * See: https://github.com/cosmos/cosmos-sdk/blob/main/types/errors/errors.go
 *
 * Enum values include:
 * - Success: Indicates the transaction was processed successfully.
 * - TxDecode: Error related to decoding the transaction.
 * - InvalidSequence: The sequence number in the transaction is invalid.
 * - Unauthorized: The operation is not authorized.
 * - InsufficientFunds: The account has insufficient balance to process the transaction.
 * - UnknownRequest: The transaction request is unknown.
 * - InvalidAddress: The address provided is invalid.
 * - InvalidPubKey: The public key is invalid.
 * - UnknownAddress: The address is not recognized.
 * - InvalidCoins: The coins provided in the transaction are invalid.
 * - OutOfGas: The transaction ran out of allotted gas.
 * - MemoTooLarge: The memo field in the transaction is too large.
 * - InsufficientFee: The provided transaction fee is insufficient.
 * - TooManySignatures: The transaction contains too many signatures.
 * - NoSignatures: The transaction is missing required signatures.
 * - JSONMarshal: Error occurred during JSON marshaling.
 * - JSONUnmarshal: Error occurred during JSON unmarshaling.
 * - InvalidRequest: The transaction request is invalid.
 * - TxInMempoolCache: The transaction is already in the mempool cache.
 * - MempoolIsFull: The mempool is full and cannot accept new transactions.
 * - TxTooLarge: The transaction size exceeds the allowed limit.
 * - KeyNotFound: The specified key could not be found.
 * - WrongPassword: The password provided is incorrect.
 * - orInvalidSigner: There is an invalid signer in the transaction.
 * - orInvalidGasAdjustment: The gas adjustment is invalid.
 * - InvalidHeight: The specified height is invalid.
 * - InvalidVersion: The transaction specifies an invalid version.
 * - InvalidChainID: The chain ID specified is invalid.
 * - InvalidType: The transaction type is invalid.
 * - TxTimeoutHeight: The transaction has exceeded its timeout height.
 * - UnknownExtensionOptions: Extension options are unknown.
 * - WrongSequence: Transaction sequence is incorrect.
 * - PackAny: Error when packing Any types.
 * - UnpackAny: Error when unpacking Any types.
 * - Logic: Indicates a logical error occurred.
 * - Conflict: A conflict was detected during processing.
 * - NotSupported: The operation is not supported.
 * - NotFound: The requested resource or data was not found.
 * - IO: An I/O error occurred.
 * - AppConfig: Error related to application configuration.
 * - InvalidGasLimit: The provided gas limit is invalid.
 * - TxTimeout: Indicates a transaction timeout occurred.
 */
export enum TransactionResult {
  Success = 0,
  TxDecode = 2,
  InvalidSequence = 3,
  Unauthorized = 4,
  InsufficientFunds = 5,
  UnknownRequest = 6,
  InvalidAddress = 7,
  InvalidPubKey = 8,
  UnknownAddress = 9,
  InvalidCoins = 10,
  OutOfGas = 11,
  MemoTooLarge = 12,
  InsufficientFee = 13,
  TooManySignatures = 14,
  NoSignatures = 15,
  JSONMarshal = 16,
  JSONUnmarshal = 17,
  InvalidRequest = 18,
  TxInMempoolCache = 19,
  MempoolIsFull = 20,
  TxTooLarge = 21,
  KeyNotFound = 22,
  WrongPassword = 23,
  orInvalidSigner = 24,
  orInvalidGasAdjustment = 25,
  InvalidHeight = 26,
  InvalidVersion = 27,
  InvalidChainID = 28,
  InvalidType = 29,
  TxTimeoutHeight = 30,
  UnknownExtensionOptions = 31,
  WrongSequence = 32,
  PackAny = 33,
  UnpackAny = 34,
  Logic = 35,
  Conflict = 36,
  NotSupported = 37,
  NotFound = 38,
  IO = 39,
  AppConfig = 40,
  InvalidGasLimit = 41,
  TxTimeout = 42,
}
