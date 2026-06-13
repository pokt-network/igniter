import type {PocketBlockchain, StakeSupplierParams, Supplier, VerifyOutcome, SupplierEffect} from '@igniter/pocket'
import {isSequenceMismatchError, parseExpectedSequence} from '@igniter/pocket'
import type {ApplicationSettings, InsertKey, Key, KeyWithGroup, Service, Transaction} from '@igniter/db/provider/schema'
import type {VerificationDecision} from '@igniter/tx-verify'
import {ApplicationFailure, log} from '@temporalio/activity'
import DAL from '@/lib/dal/DAL'
import {KeysMinMax} from '@/lib/dal/keys'
import {KeyState, RemediationHistoryEntryReason, TransactionType, TransactionStatus, TransactionTrigger} from '@igniter/db/provider/enums'
import {BuildSupplierServiceConfigHandler, CompareSupplierServiceConfigHandler} from '@igniter/domain/provider/operations';
import {addOrUpdateRemediationHistory} from "@/lib/utils";
import {redactStakeSupplierParams} from "@/lib/redactors";
import {getExpectedServicesFromKey} from '@igniter/domain/provider/utils'
import { ServiceConfigUpdate } from '@igniter/pocket/proto/pocket/shared/supplier'

export type Height = number

export type LoadKeysInRangeParams = {
  minId: number;
  maxId: number;
  states: KeyState[];
}

export type LoadKeysInRangeResult = Array<{ id: number; address: string, state: KeyState }>

export type ProcessSupplierParams = {
  address: string;
  height: number;
}

export type UpsertSupplierStatusResult = {
  state: KeyState;
  remediationReasons: RemediationHistoryEntryReason[];
  prev?: {
    state?: KeyState;
    remediationReasons?: RemediationHistoryEntryReason[];
  };
  supplier?: Supplier;
}

export type RemediateSupplierParams = ProcessSupplierParams & {
  reasons: RemediationHistoryEntryReason[];
}

export type GovernanceSyncResult = {
  inserted: number;
  updated: number;
  disabled: number;
}

/** Number of consecutive unavailable checks between critical alerts for a chronically-unverifiable tx. */
const VERIFY_UNAVAILABLE_ALERT_THRESHOLD = Number(process.env.VERIFY_UNAVAILABLE_ALERT_THRESHOLD ?? 50)

/** Per-sweep hash-scan window, matching the on-chain mempool expiration window. */
const TX_EXPIRATION_BLOCKS = 30

/**
 * Maps a provider transaction + its key into the expected on-chain supplier effect.
 * Returns null when the tx has no supplier-state path so the verifier skips the
 * supplier verification path for it.
 */
export function supplierEffectFromKey(
  tx: Transaction,
  key: Pick<Key, 'address' | 'stakeOwner'>,
): { operatorAddress: string; effect: SupplierEffect } | null {
  if (tx.type === TransactionType.Stake) {
    // Goal-state per remediation reason:
    //  - OwnerInitialStake: trigger condition is supplier-present-with-ZERO-services
    //    (upsertSupplierStatus), so the goal is services present — NOT mere existence.
    //  - ServiceMismatch / AddressGroupMigration: a config-update over an existing
    //    supplier; existence proves nothing about THIS tx → hash-only (null).
    if (tx.reason === RemediationHistoryEntryReason.OwnerInitialStake) {
      return {
        operatorAddress: key.address,
        effect: { kind: 'stake-services-present', ownerAddress: key.stakeOwner ?? '' },
      }
    }
    return null
  }

  if (tx.type === TransactionType.Unstake) {
    return {
      operatorAddress: key.address,
      effect: { kind: 'unstake', minSessionEndHeight: tx.executionHeight ?? 0 },
    }
  }

  return null
}

export const providerActivities = (dal: DAL, pocketRpcClient: PocketBlockchain) => {
  const activities = {
  async syncDelegatorsFromGovernance(): Promise<GovernanceSyncResult> {
    const settings = await dal.settings.loadSettings()
    if (!settings) {
      throw ApplicationFailure.nonRetryable('Application settings not found', 'settings_not_found')
    }

    const cdnUrlTemplate = process.env.DELEGATORS_CDN_URL
    if (!cdnUrlTemplate) {
      throw ApplicationFailure.nonRetryable('DELEGATORS_CDN_URL environment variable is not defined', 'missing_env')
    }

    const cdnUrl = cdnUrlTemplate.replace(
      '{chainId}',
      settings.chainId.replace('lego-testnet', 'beta'),
    )

    log.info('syncDelegatorsFromGovernance: Fetching from CDN', { cdnUrl })

    const response = await fetch(cdnUrl)
    if (!response.ok) {
      throw ApplicationFailure.retryable(`Failed to fetch delegators: ${response.statusText}`, 'fetch_failed')
    }

    type CdnDelegator = {
      name: string;
      identity: string;
      identityHistory: string[];
    }

    const delegatorsFromCdn = (await response.json()) as CdnDelegator[]
    log.info('syncDelegatorsFromGovernance: Fetched delegators', { count: delegatorsFromCdn.length })

    const result = await dal.delegators.upsertFromGovernance(
      delegatorsFromCdn,
      settings.ownerIdentity,
    )

    log.info('syncDelegatorsFromGovernance: Done', result)
    return result
  },

  /**
   * Mock activity.
   */
  async mockActivity(): Promise<void> {
    // mock activity
    return
  },
  /**
   * Returns the latest block height from the blockchain.
   * @returns GetLatestBlockResult
   */
  async getLatestBlock(): Promise<Height> {
    return pocketRpcClient.getHeight()
  },
  /**
   * Counts the number of keys in the database and return the min and max id.
   * @returns KeysMinMax
   */
  async getKeysMinAndMax(): Promise<KeysMinMax> {
    return dal.keys.getKeysMinAndMax()
  },

  /**
   * Loads a range of keys based on the specified parameters.
   *
   * @param {LoadKeysInRangeParams} params - The parameters containing the start and end identifiers for the key range.
   *                                          `params.afterId` defines the starting key (exclusive).
   *                                          `params.endId` defines the ending key (exclusive).
   * @return {Promise<LoadKeysInRangeResult>} A promise that resolves to the result of the loaded keys within the given range.
   */
  async loadKeysInRange(params: LoadKeysInRangeParams): Promise<LoadKeysInRangeResult> {
    return dal.keys.loadKeysInRange(params.minId, params.maxId, params.states)
  },

  /**
   * Upserts the supplier status into the database.
   * @param params ProcessSupplierParams
   */
  async upsertSupplierStatus(params: ProcessSupplierParams): Promise<UpsertSupplierStatusResult> {
    log.info('upsertSupplierStatus: Querying for keys, settings, balance and supplier', {params})
    const [key, settings, balance, supplier]: [KeyWithGroup, ApplicationSettings, number, Supplier] = await Promise.all([
      dal.keys.loadKey(params.address),
      dal.settings.loadSettings(),
      pocketRpcClient.getBalance(params.address),
      pocketRpcClient.getSupplier(params.address),
    ])

    if (!key) {
      throw new ApplicationFailure('key not found', 'not_found', true)
    }

    const prevState = key.state
    const prevRemediationReasons = (key.remediationHistory ?? []).map((rh) => rh.reason)

    const loggerContext = {
      key: key.address,
    }

    const update: Partial<InsertKey> = {
      lastUpdatedHeight: params.height, // always set the last updated height.
      balanceUpokt: BigInt(balance), // always set the balance.
    }

    // if !supplier then is available only if the current state is different from available
    // if supplier and unstakeSessionEndHeight = 0 then is staked
    // if supplier and unstakeSessionEndHeight > 0 and unstakeSessionEndHeight < height then is unstaking
    // if supplier and unstakeSessionEndHeight > 0 and unstakeSessionEndHeight >= height then is unstaked

    // Determine the key state
    if (!supplier) {
      switch (key.state) {
        case KeyState.Imported:
          update.state = KeyState.Available
          break
        case KeyState.Unstaking:
          update.state = KeyState.Unstaked
          break
        case KeyState.Delivered:
        case KeyState.MissingStake:
          // If delivered/missing_stake for more than 24h with no supplier, release the key
          if (key.deliveredAt && key.deliveredAt.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
            update.state = KeyState.Available
            update.deliveredAt = null
            update.deliveredTo = null
            update.ownerAddress = null
            // Keep addressGroupId — key returns to its original group
            update.delegatorRevSharePercentage = 0
            update.delegatorRewardsAddress = ''
          } else {
            update.state = key.state
          }
          break;
        default:
          update.state = key.state
      }
    } else {
      const {ownerAddress, stake, unstakeSessionEndHeight, services, serviceConfigHistory} = supplier;

      // Supplier is present, determine state based on unstakeSessionEndHeight
      if (unstakeSessionEndHeight === 0) {
        update.state = KeyState.Staked;
      } else if (params.height >= unstakeSessionEndHeight) {
        update.state = KeyState.Unstaked;
      } else {
        update.state = KeyState.Unstaking;
      }

      if (update.state === KeyState.Unstaking || update.state === KeyState.Staked) {
        update.stakeOwner = ownerAddress
        update.stakeAmountUpokt = BigInt(stake ? stake.amount : '0')
        update.services = services || []

        if (key.state === KeyState.Imported || key.state === KeyState.Available) {
          // means the key is imported and is already staked, let's set it to the owner address
          update.ownerAddress = supplier.ownerAddress
        }

        // Backfill for legacy keys with empty owner address
        if (!key.ownerAddress && supplier.ownerAddress) {
          update.ownerAddress = supplier.ownerAddress
        }
      }

      log.debug('remediateSupplier: Checking if is owner initial stake remediation needed', {
        ...loggerContext,
        currentState: update.state,
        keyDelegatorAddress: key.delegatorRewardsAddress,
        services: supplier.services.length,
        servicesHistory: supplier.serviceConfigHistory?.length,
      })

      // --- NEW: cooldown / dedupe ---
      const existingOwnerInitialStake = (key.remediationHistory ?? []).find(
          (rh) => rh.reason === RemediationHistoryEntryReason.OwnerInitialStake
      )

      const now = Date.now()
      const cooldownMs = 10 * 60 * 1000 // 10 minutes; tune as you like
      const existingTs = existingOwnerInitialStake?.timestamp ?? 0
      const isInCooldown = existingOwnerInitialStake ? (now - existingTs) < cooldownMs : false

      const isOwnerInitialStakeRemediationNeeded =
        update.state === KeyState.Staked &&
        key.delegatorRewardsAddress && // We can only remediate if the key has a delegator rewards address
        supplier.services.length === 0 && // The supplier is staked without active services
          (supplier.serviceConfigHistory?.length ?? 0) === 0 // There are no pending activations or deactivations, this supplier is pristine

      if (isOwnerInitialStakeRemediationNeeded) {
        if (!isInCooldown) {
          update.remediationHistory = addOrUpdateRemediationHistory(
              {
                message: 'The supplier is not configured with any services.',
                reason: RemediationHistoryEntryReason.OwnerInitialStake,
                timestamp: Date.now(),
              },
              key.remediationHistory ?? []
          )
        } else {
          log.debug('upsertSupplierStatus: OwnerInitialStake detected but in cooldown; not updating remediation history.', {
            ...loggerContext,
            cooldownMs,
            existingTs,
          })
        }
      }

      log.debug('upsertSupplierStatus: Checking if is operational funds remediation needed', {
        ...loggerContext,
        currentState: update.state,
        balance: balance,
        minimumOperationalFunds: settings?.minimumOperationalFunds,
      })

      if (update.state === KeyState.Staked && balance && settings?.minimumOperationalFunds) {
        if (balance < settings?.minimumOperationalFunds) {
          update.remediationHistory = addOrUpdateRemediationHistory(
            {
              message: `The operational funds for this supplier (used to submit claim and proof transactions) are below the providers desired threshold (${settings?.minimumOperationalFunds} uPokt)`,
              reason: RemediationHistoryEntryReason.SupplierFundsTooLow,
              timestamp: Date.now(),
            },
            key.remediationHistory ?? []
          )
        }
      }

      log.debug('upsertSupplierStatus: Checking if is stake remediation needed', {
        ...loggerContext,
        currentState: update.state,
        stakeAmount: supplier.stake.amount,
        minimumStake: settings?.minimumStake,
      })

      if (update.state === KeyState.Staked && supplier.stake.amount && settings?.minimumStake) {
        const amount = parseInt(supplier.stake.amount, 10)
        if (amount < settings?.minimumStake) {
          update.remediationHistory = addOrUpdateRemediationHistory(
            {
              message: `The stake for this supplier is below the providers desired threshold (${settings?.minimumStake} uPokt)`,
              reason: RemediationHistoryEntryReason.SupplierStakeTooLow,
              timestamp: Date.now(),
            },
            key.remediationHistory ?? []
          )
        }
      }

      const hasAddressGroupMigrationPending = (key.remediationHistory ?? []).some(
        (rh) => rh.reason === RemediationHistoryEntryReason.AddressGroupMigration
      )

      if (!isOwnerInitialStakeRemediationNeeded && !hasAddressGroupMigrationPending && update.state === KeyState.Staked) {
        const expectedServices = getExpectedServicesFromKey(key)

        // only compare to the active services from the history, so if a service stake change is about to take place, we override it
        const activeServicesFromHistory = serviceConfigHistory?.filter((sc: ServiceConfigUpdate) => !sc.deactivationHeight && !!sc.service).map((sc: ServiceConfigUpdate) => sc.service) || []

        const compareHandler = new CompareSupplierServiceConfigHandler()
        const { isEqual: activeServicesEquals } = compareHandler.execute({
          serviceConfigSetA: activeServicesFromHistory,
          serviceConfigSetB: expectedServices,
        })

        if (!activeServicesEquals) {
          log.warn('upsertSupplierStatus: The key does not have the expected services configured in the service config history. Needs remediation.', {
            address: key.address,
            activeServicesFromHistory,
            expectedServices,
          })
          update.remediationHistory = addOrUpdateRemediationHistory(
            {
              message: 'The key does not have the expected services configured.',
              reason: RemediationHistoryEntryReason.ServiceMismatch,
              timestamp: Date.now(),
            },
            key.remediationHistory ?? []
          )
        } else {
          // Services match — clear any stale ServiceMismatch entry
          const currentHistory = update.remediationHistory ?? key.remediationHistory ?? []
          const hasStaleEntry = currentHistory.some((rh) => rh.reason === RemediationHistoryEntryReason.ServiceMismatch)
          if (hasStaleEntry) {
            log.info(`upsertSupplierStatus: The key ${key.address} services now match. Clearing stale ServiceMismatch entry.`)
            update.remediationHistory = currentHistory.filter((rh) => rh.reason !== RemediationHistoryEntryReason.ServiceMismatch)
          }
        }
      }

      const remediationReasons = update.remediationHistory?.map((rh) => rh.reason);

      log.debug('upsertSupplierStatus: Checking if is remediation needed', {
        ...loggerContext,
        remediationReasons,
      })

      // Only set the state to attention needed if the key is staked and the initial owner stake has been remediated. Otherwise, it will remain staked.
      if (
        remediationReasons?.length &&
        !remediationReasons.includes(RemediationHistoryEntryReason.OwnerInitialStake) &&
        !remediationReasons.includes(RemediationHistoryEntryReason.ServiceMismatch) &&
        !remediationReasons.includes(RemediationHistoryEntryReason.DelegatorAddressMissing) &&
        !remediationReasons.includes(RemediationHistoryEntryReason.AddressGroupMigration)
      ) {
        update.state = KeyState.AttentionNeeded
      }
    }

    log.debug('Updating supplier', { params, update })
    await dal.keys.updateKey(params.address, update, params.height)
    log.info('Update Supplier done!', {params})

    const currentState = update.state ?? prevState
    const currentRemediationReasons = (update.remediationHistory ?? key.remediationHistory ?? []).map((rh) => rh.reason)

    const result: UpsertSupplierStatusResult = {
      state: currentState,
      remediationReasons: currentRemediationReasons,
    }

    const prevDiff: UpsertSupplierStatusResult['prev'] = {}
    if (prevState !== currentState) {
      prevDiff.state = prevState
    }

    const addedReasons = currentRemediationReasons.filter((r) => !prevRemediationReasons.includes(r))
    const removedReasons = prevRemediationReasons.filter((r) => !currentRemediationReasons.includes(r))
    if (addedReasons.length || removedReasons.length) {
      prevDiff.remediationReasons = prevRemediationReasons
    }

    if (Object.keys(prevDiff).length) {
      result.prev = prevDiff
    }

    result.supplier = supplier

    return result
  },

  /**
   * Remediates the supplier by checking if remediation is required and performing necessary actions,
   * including staking and updating the supplier's state.
   *
   * @param {RemediateSupplierParams} params - The parameters required to remediate the supplier, including
   * the supplier's address, remediation reasons, and relevant height.
   * @return {Promise<{success: boolean, message: string}>} An object indicating the success or failure of the remediation process
   * and an accompanying message.
   */
  async remediateSupplier(params: RemediateSupplierParams) {
    log.info('remediateSupplier: Execution started', {params})
    const [key, supportedServices, balance, supplier]: [KeyWithGroup, Service[], number, Supplier] = await Promise.all([
      dal.keys.loadKey(params.address),
      dal.services.loadServices(),
      pocketRpcClient.getBalance(params.address),
      pocketRpcClient.getSupplier(params.address),
    ])

    if (!key) {
      log.warn('remediateSupplier: Key not found', {params})
      throw ApplicationFailure.nonRetryable('Key not found', 'not_found')
    }

    if (!key.addressGroup) {
      log.warn('remediateSupplier: Address Group not found', {params})
      throw ApplicationFailure.nonRetryable('Key address group not found', 'not_found')
    }

    if (!supplier) {
      log.info('remediateSupplier: Supplier not found on-chain, skipping remediation', {params})
      return {
        success: true,
        message: 'Supplier not found on-chain — nothing to remediate.'
      }
    }

    if (key.remediationHistory?.length === 0) {
      log.info('remediateSupplier: No remediation history found. Nothing to do here. Bye!', {params})
      return {
        success: true,
        message: 'No remediation history found.'
      }
    }

    log.debug('remediateSupplier: Loaded key, supportedServices, balance and supplier', {
      key: {
        address: key.address,
        ownerAddress: key?.ownerAddress,
        state: key.state,
        balance: Number(balance),
      },
      supportedServices: supportedServices.map((s) => ({
        id: s.serviceId,
        name: s.name,
      })),
      supportedServicesCount: supportedServices.length,
      supplier: {
        ownerAddress: supplier?.ownerAddress,
        operatorAddress: supplier?.operatorAddress,
        stake: supplier?.stake,
        services: supplier?.services?.length,
        unstakeSessionEndHeight: supplier?.unstakeSessionEndHeight,
        serviceConfigHistory: supplier?.serviceConfigHistory?.length,
      }
    })

    // --- Determine what we can actually remediate ---
    const remediationHistory = key.remediationHistory ?? [];
    const hasOwnerInitialStakeReason = params.reasons.includes(RemediationHistoryEntryReason.OwnerInitialStake);

    const ownerInitialStakeEntry = hasOwnerInitialStakeReason
        ? remediationHistory.find((rh) => rh.reason === RemediationHistoryEntryReason.OwnerInitialStake) ?? null
        : null

    const hasServiceMismatchReason = params.reasons.includes(RemediationHistoryEntryReason.ServiceMismatch);

    const serviceMismatchEntry = hasServiceMismatchReason
      ? remediationHistory.find((rh) => rh.reason === RemediationHistoryEntryReason.ServiceMismatch) ?? null
      : null

    const hasAddressGroupMigrationReason = params.reasons.includes(RemediationHistoryEntryReason.AddressGroupMigration);

    const addressGroupMigrationEntry = hasAddressGroupMigrationReason
      ? remediationHistory.find((rh) => rh.reason === RemediationHistoryEntryReason.AddressGroupMigration) ?? null
      : null

    // Nothing actionable? DO NOT stake.
    if (!ownerInitialStakeEntry && !serviceMismatchEntry && !addressGroupMigrationEntry) {
      log.info('remediateSupplier: No actionable remediation in reasons. Skipping stake.', {
        params,
        reasons: params.reasons,
      })
      return {
        success: true,
        message: 'No actionable remediation for this supplier.',
      }
    }

    if (ownerInitialStakeEntry) {
      // If supplier already has services or has config history, OwnerInitialStake is no longer valid.
      const supplierAlreadyConfigured =
        (supplier.services?.length ?? 0) > 0 || (supplier.serviceConfigHistory?.length ?? 0) > 0

      if (supplierAlreadyConfigured) {
        log.info('remediateSupplier: Supplier already configured; clearing OwnerInitialStake entry without staking.', {
          params,
          services: supplier.services?.length ?? 0,
          servicesHistory: supplier.serviceConfigHistory?.length ?? 0,
        })

        const update: Partial<InsertKey> = {
          lastUpdatedHeight: params.height,
          balanceUpokt: BigInt(balance),
          // remove only OwnerInitialStake entry; keep other entries if any
          remediationHistory: remediationHistory.filter((rh) => rh.reason !== RemediationHistoryEntryReason.OwnerInitialStake),
        }

        try {
          await dal.keys.updateKey(params.address, update, params.height)
        } catch (e) {
          log.warn('remediateSupplier: Update Supplier failed while clearing OwnerInitialStake!', {
            params,
            error: e,
          })
          throw ApplicationFailure.retryable(
            `Failed while updating the supplier status for ${params.address}.`,
            'db_update_failed',
          )
        }

        return { success: true, message: 'Supplier already configured; remediation cleared.' }
      }
    }

    const stakeParams: StakeSupplierParams = {
      signerPrivateKey: key.privateKey,
      signer: key.address,
      ownerAddress: supplier.ownerAddress,
      operatorAddress: key.address,
    }

    log.debug('remediateSupplier: Preparing initial owner stake remediation', {
      entry: ownerInitialStakeEntry || serviceMismatchEntry,
    })

    const buildSupplierServiceConfigHandler = new BuildSupplierServiceConfigHandler()
    stakeParams.services = buildSupplierServiceConfigHandler.execute({
      services: supportedServices,
      addressGroup: key.addressGroup,
      ownerAddress: supplier.ownerAddress,
      operatorAddress: key.address,
      requestRevShare: [{
        revSharePercentage: key.delegatorRevSharePercentage ?? 0,
        address: key.delegatorRewardsAddress ?? '',
      }]
    })

    if (!stakeParams.services || stakeParams.services.length === 0) {
      log.warn('remediateSupplier: Refusing to stake because computed services is empty', {
        params,
        supportedServicesCount: supportedServices.length,
        addressGroup: key.addressGroup?.id ?? 'unknown',
      })
      throw ApplicationFailure.nonRetryable(
        `Refusing to stake with empty services config for ${params.address}.`,
        'empty_services',
      )
    }

    log.debug('remediateSupplier: Executing stake transaction', {
      stakeParams: redactStakeSupplierParams(stakeParams),
      servicesToStakeCount: stakeParams.services.length,
    })

    // Re-entry guard: if this key already has a broadcast, still-pending tx awaiting
    // verification, do NOT re-stake — the verifier owns its terminal transition.
    if (await dal.transactions.hasPendingTx(key.id)) {
      log.info('remediateSupplier: key has a pending verification tx, skipping re-stake', { address: params.address })
      return
    }

    let txResult = await pocketRpcClient.stakeSupplier(stakeParams)

    // Retry once with the expected sequence if we hit a sequence mismatch error
    if (!txResult.success && txResult.message && isSequenceMismatchError(txResult.message)) {
      const expectedSequence = parseExpectedSequence(txResult.message)
      log.warn('remediateSupplier: Sequence mismatch detected', {
        address: params.address,
        originalError: txResult.message,
        parsedExpectedSequence: expectedSequence,
      })
      if (expectedSequence != null) {
        log.info('remediateSupplier: Retrying stake transaction with expected sequence', {
          address: params.address,
          expectedSequence,
        })
        txResult = await pocketRpcClient.stakeSupplier(stakeParams, expectedSequence)
        log.info('remediateSupplier: Retry stake transaction result', {
          address: params.address,
          success: txResult.success,
          code: txResult.code,
          message: txResult.message,
        })
        // If the retry also fails with a sequence mismatch, throw so Temporal can re-attempt
        // with a fresh sequence fetch. This handles cases where the sequence advances by 2+
        // between attempts (e.g., concurrent remediation activities for the same owner).
        if (!txResult.success && txResult.message && isSequenceMismatchError(txResult.message)) {
          throw ApplicationFailure.retryable(
            `remediateSupplier: Sequence mismatch persisted after retry for ${params.address}: ${txResult.message}`,
          )
        }
      } else {
        log.error('remediateSupplier: Could not parse expected sequence from error message, skipping retry', {
          address: params.address,
          originalError: txResult.message,
        })
      }
    }

    log.debug('remediateSupplier: Stake transaction result', {txResult})

    const activeEntry = ownerInitialStakeEntry || serviceMismatchEntry || addressGroupMigrationEntry
    const isManual = activeEntry?.message?.includes('requested by operator') ?? false

    // Broadcast got a hash → record the tx as Pending and hand it to the verifier.
    // Do NOT flip key state, do NOT clear the remediation entry, do NOT throw:
    // the verifier owns the terminal transition (KeyState.Staked / RemediationFailed).
    if (txResult.transactionHash) {
      try {
        await dal.transactions.insert({
          keyId: key.id,
          keyAddress: key.address,
          type: TransactionType.Stake,
          status: TransactionStatus.Pending,
          reason: activeEntry?.reason ?? null,
          trigger: isManual ? TransactionTrigger.Manual : TransactionTrigger.Automatic,
          hash: txResult.transactionHash,
          code: txResult.code ?? null,
          message: txResult.message ?? null,
          executionHeight: params.height,
        })
      } catch (e) {
        // Transaction recording is best-effort — don't fail remediation if it errors
        log.warn('remediateSupplier: Failed to record pending transaction', { address: params.address, error: e })
      }

      // Update only the benign fields; leave state + remediation history untouched.
      try {
        await dal.keys.updateKey(params.address, {
          lastUpdatedHeight: params.height,
          balanceUpokt: BigInt(balance),
        }, params.height)
      } catch (e) {
        log.warn('remediateSupplier: Update Supplier failed while recording pending tx!', { params, error: e })
        throw ApplicationFailure.retryable(
          `Failed while updating the supplier status for ${params.address}.`,
          'db_update_failed',
        )
      }

      log.info('remediateSupplier: Stake broadcast; pending verification', { params, hash: txResult.transactionHash })
      return {
        success: true,
        message: 'Stake transaction broadcast; pending verification.',
      }
    }

    // No transactionHash → broadcast failed. Keep the OLD behavior: record Failure,
    // mark the key RemediationFailed (keep the remediation entry), and throw.
    try {
      await dal.transactions.insert({
        keyId: key.id,
        keyAddress: key.address,
        type: TransactionType.Stake,
        status: TransactionStatus.Failure,
        reason: activeEntry?.reason ?? null,
        trigger: isManual ? TransactionTrigger.Manual : TransactionTrigger.Automatic,
        hash: null,
        code: txResult.code ?? null,
        message: txResult.message ?? null,
        executionHeight: params.height,
      })
    } catch (e) {
      // Transaction recording is best-effort — don't fail remediation if it errors
      log.warn('remediateSupplier: Failed to record transaction', { address: params.address, error: e })
    }

    const update: Partial<InsertKey> = {
      lastUpdatedHeight: params.height,
      balanceUpokt: BigInt(balance),
      state: KeyState.RemediationFailed,
      // Keep the remediation entry so the next cycle can retry
    }

    log.debug(`remediateSupplier: Stake transaction failed to broadcast for: ${key.address} ${JSON.stringify(txResult)}`)

    log.debug('remediateSupplier: Updating supplier', { params, update }) // NOTE: adding the update could result in an error due to BIGINT
    try {
      await dal.keys.updateKey(params.address, update, params.height)
      log.debug('remediateSupplier: Update Supplier done!', { params })
    } catch (e) {
      log.warn('remediateSupplier: Update Supplier failed!', { params, error: e })
      throw ApplicationFailure.retryable(
        `Failed while updating the supplier status for ${params.address}. Key state: ${update.state}. Stake tx success: ${txResult.success}, message: ${txResult.message}`,
        'db_update_failed',
      )
    }

    log.warn('remediateSupplier: Stake transaction failed', { params, txResult })
    throw ApplicationFailure.nonRetryable(
      `Remediation transaction failed for ${params.address}. Key state: ${update.state}. Tx code: ${txResult.code}, message: ${txResult.message}`,
      'stake_tx_failed',
    )
  },

  /**
   * The verifier's queue: pending transactions that have been broadcast (have a hash).
   */
  async listPendingWithHash() {
    const txs = await dal.transactions.listPendingWithHash()
    return txs.map(({ id, executionHeight }) => ({ id, executionHeight }))
  },

  /**
   * Verifies a broadcast tx by hash, scanning from one block past its last covered
   * height (or its execution height on the first sweep). Maps the pocket tri-state
   * result down to the minimal shape the pure decision logic consumes.
   */
  async verifyTxHash(transactionId: number): Promise<VerifyOutcome<{ success: boolean; code: number; gasUsed: string }>> {
    const txn = await dal.transactions.getTransaction(transactionId)
    if (!txn?.hash) {
      throw new Error('verifyTxHash: tx missing hash')
    }
    const startHeight = txn.lastCoveredHeight != null ? txn.lastCoveredHeight + 1 : (txn.executionHeight ?? 0)
    const out = await pocketRpcClient.verifyTransaction(txn.hash, startHeight, TX_EXPIRATION_BLOCKS)
    if (out.status !== 'confirmed') return out
    // gasUsed serialized as a string: a bigint cannot cross the Temporal activity
    // boundary (default payload converter cannot encode BigInt).
    return {
      status: 'confirmed',
      data: { success: out.data.success, code: out.data.code, gasUsed: out.data.gasUsed.toString() },
    }
  },

  /**
   * Verifies a broadcast tx by its expected on-chain supplier goal-state. Returns null for
   * tx types with no supplier-state path (e.g. ServiceMismatch/AddressGroupMigration stake txs,
   * or non-supplier tx types) so the decision logic treats the supplier path as inapplicable.
   * Maps pocket's tri-state result into SupplierPathOutcome for decide v2.
   */
  async verifySupplierEffect(transactionId: number): Promise<import('@igniter/tx-verify').SupplierPathOutcome | null> {
    const txn = await dal.transactions.getTransaction(transactionId)
    if (!txn) {
      throw new Error('verifySupplierEffect: tx not found')
    }
    const key = await dal.keys.loadKey(txn.keyAddress)
    if (!key) {
      throw new Error('verifySupplierEffect: key not found')
    }
    const parsed = supplierEffectFromKey(txn, key)
    if (!parsed) return null
    const out = await pocketRpcClient.verifySupplierEffect(parsed.operatorAddress, parsed.effect)
    if (out.status === 'confirmed') return { status: 'confirmed' }
    if (out.status === 'absent') return { status: 'absent', absentOperators: [parsed.operatorAddress] }
    return { status: 'unavailable' }
  },

  /**
   * Failure-bound evidence for a provider tx. Provider txs are self-signed and have
   * a timeoutHeight column (Cosmos ante rejects inclusion after that height). There is
   * no signedPayload column, so sequence evidence is unavailable — failure relies solely
   * on timeoutHeight coverage.
   */
  async checkTxValidityEvidence(transactionId: number): Promise<{
    txTimeoutHeight: number | null
    sequence: { consumed: boolean; observedAtHeight: number } | null
  }> {
    const txn = await dal.transactions.getTransaction(transactionId)
    return { txTimeoutHeight: txn?.timeoutHeight ?? null, sequence: null }
  },

  /**
   * Applies a verification decision computed by the pure `decideVerification` (v2 shape).
   * Pending → record progress (coverage/unavailable decay) + maybe alert on chronic unavailability.
   * Terminal → run the provider key-state effect FIRST (keyed off goal-state effects, not tx outcome),
   * then atomically CAS the tx to its terminal status. Effects-before-CAS so a failure mid-effect
   * re-sweeps and re-runs the idempotent effect instead of losing it to a lost CAS.
   */
  async applyVerificationDecision(transactionId: number, decision: VerificationDecision): Promise<void> {
    if (decision.tx === 'pending') {
      await dal.transactions.recordVerificationProgress(transactionId, {
        lastCoveredHeight: decision.newLastCoveredHeight,
        incUnavailable: decision.incUnavailable,
      })
      if (decision.incUnavailable) await maybeAlertUnavailable(transactionId)
      return
    }

    const txn = await dal.transactions.getTransaction(transactionId)
    if (!txn) return

    // Effects keyed off GOAL-STATE, not tx outcome: a tx that failed on-chain while a
    // sibling achieved the goal must NOT drag the key to RemediationFailed.
    if (decision.effects !== 'none') {
      await flipKeyForTx(txn, decision.effects)
    }

    const status = decision.tx === 'success' ? TransactionStatus.Success : TransactionStatus.Failure
    await dal.transactions.claimTerminalTransition(transactionId, status, {
      code: decision.code,
      message: decision.tx === 'success' ? 'verified'
        : decision.effects === 'apply-success' ? 'tx failed on-chain; goal met by sibling tx'
        : 'verification negative (validity bound covered, no effect)',
    })
  },
  }

  /**
   * Provider terminal effect: flips the key state for a verified stake tx.
   * Keyed off goal-state effects (not raw tx outcome) so a tx that failed on-chain
   * while a sibling achieved the goal still flips to Staked (not RemediationFailed).
   * State-CAS: keys that moved to Unstaking/Unstaked/AttentionNeeded since broadcast
   * must NOT be overwritten — those transitions take priority.
   */
  async function flipKeyForTx(
    txn: Transaction,
    effects: 'apply-success' | 'apply-failure',
  ): Promise<void> {
    const blockedStates = [KeyState.Unstaking, KeyState.Unstaked, KeyState.AttentionNeeded]
    const flipped = effects === 'apply-success'
      ? await dal.keys.flipState(txn.keyAddress, KeyState.Staked, { notFromStates: blockedStates, removeEntryReason: txn.reason ?? undefined })
      : await dal.keys.flipState(txn.keyAddress, KeyState.RemediationFailed, { notFromStates: blockedStates })
    if (!flipped) {
      log.info('flipKeyForTx: key state moved on since broadcast; flip skipped', { keyAddress: txn.keyAddress, effects })
    }
  }

  /**
   * Reads the tx and emits a critical log when its unavailable-check counter crosses a
   * multiple of the alert threshold. No status change — operator-attention only.
   */
  async function maybeAlertUnavailable(transactionId: number): Promise<void> {
    const txn = await dal.transactions.getTransaction(transactionId)
    if (txn && txn.unavailableChecks > 0 && txn.unavailableChecks % VERIFY_UNAVAILABLE_ALERT_THRESHOLD === 0) {
      log.error(
        'TX unverifiable: RPC repeatedly unavailable — operator attention needed',
        { transactionId, unavailableChecks: txn.unavailableChecks },
      )
    }
  }

  return activities
}
