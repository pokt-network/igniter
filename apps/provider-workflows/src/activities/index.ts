import type {PocketBlockchain, StakeSupplierParams, Supplier} from '@igniter/pocket'
import type {ApplicationSettings, InsertKey, RemediationHistoryEntry, Service} from '@igniter/db/provider/schema'
import {ApplicationFailure, log} from '@temporalio/activity'
import DAL from '@/lib/dal/DAL'
import {KeysMinMax, KeyWithGroup} from '@/lib/dal/keys'
import {KeyState, RemediationHistoryEntryReason} from '@igniter/db/provider/enums'
import {BuildSupplierServiceConfigHandler,} from '@igniter/domain/provider/operations';
import {addOrUpdateRemediationHistory} from "@/lib/utils";
import {redactStakeSupplierParams} from "@/lib/redactors";

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

export type RemediateSupplierParams = ProcessSupplierParams & {
  reasons: RemediationHistoryEntryReason[];
}

export const providerActivities = (dal: DAL, pocketRpcClient: PocketBlockchain) => ({
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
  async upsertSupplierStatus(params: ProcessSupplierParams): Promise<boolean> {
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
          // If the key was delivered more than 24 hours ago mark it as missing stake
          update.state = key.deliveredAt &&
            key.deliveredAt.getTime() < Date.now() - 24 * 60 * 60 * 1000 // 24 h
            ? KeyState.MissingStake
            : key.state;
          break;
        default:
          update.state = key.state
      }
    } else {
      const {ownerAddress, stake, unstakeSessionEndHeight, services} = supplier;

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

        if (key.state === KeyState.Imported) {
          // means the key is imported and is already staked, let's set it to the owner address
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

      log.debug('upsertSupplierStatus: Checking if the key has the delegatorRewardAddress configured', {
        ...loggerContext,
        delegatorRewardAddress: key.delegatorRewardsAddress,
      })

      if (update.state === KeyState.Staked && !key.delegatorRewardsAddress) {
        update.remediationHistory = addOrUpdateRemediationHistory(
          {
            message: 'The key does not have a delegator address configured, this will prevent any automatic remediation from happening.',
            reason: RemediationHistoryEntryReason.DelegatorAddressMissing,
            timestamp: Date.now(),
          },
          key.remediationHistory ?? []
        )
      }

      // TODO: Check for the case where the configurations on the addressGroup does not match the configurations on the supplier

      const remediationReasons = update.remediationHistory?.map((rh) => rh.reason);

      log.debug('upsertSupplierStatus: Checking if is remediation needed', {
        ...loggerContext,
        remediationReasons,
      })

      // Only set the state to attention needed if the key is staked and the initial owner stake has been remediated. Otherwise, it will remain staked.
      if (remediationReasons?.length && !remediationReasons.includes(RemediationHistoryEntryReason.OwnerInitialStake)) {
        update.state = KeyState.AttentionNeeded
      }
    }

    log.debug('Updating supplier', { params, update })
    await dal.keys.updateKey(params.address, update, params.height)
    log.info('Update Supplier done!', {params})
    return true
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
      return {
        success: false,
        message: 'Key not found'
      }
    }

    if (!key.addressGroup) {
      log.warn('remediateSupplier: Address Group not found', {params})
      return {
        success: false,
        message: 'Key address group not found'
      }
    }

    if (!supplier) {
      log.warn('remediateSupplier: Supplier not found', {params})
      return {
        success: false,
        message: 'Supplier not found'
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

    // Nothing actionable? DO NOT stake.
    if (!ownerInitialStakeEntry) {
      log.info('remediateSupplier: No actionable remediation in reasons. Skipping stake.', {
        params,
        reasons: params.reasons,
      })
      return {
        success: true,
        message: 'No actionable remediation for this supplier.',
      }
    }

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
        return {
          success: false,
          message: 'Failed while updating the supplier status.',
          keyUpdate: update,
        }
      }

      return { success: true, message: 'Supplier already configured; remediation cleared.' }
    }

    const stakeParams: StakeSupplierParams = {
      signerPrivateKey: key.privateKey,
      signer: key.address,
      ownerAddress: supplier.ownerAddress,
      operatorAddress: key.address,
    }

    log.debug('remediateSupplier: Preparing initial owner stake remediation', {
      entry: ownerInitialStakeEntry,
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
      return {
        success: false,
        message: 'Refusing to stake with empty services config.',
      }
    }

    log.debug('remediateSupplier: Executing stake transaction', {
      stakeParams: redactStakeSupplierParams(stakeParams),
      servicesToStakeCount: stakeParams.services.length,
    })

    const txResult = await pocketRpcClient.stakeSupplier(stakeParams)

    log.debug('remediateSupplier: Stake transaction result', {txResult})

    const update: Partial<InsertKey> = {
      lastUpdatedHeight: params.height,
      balanceUpokt: BigInt(balance),
    }

    if (!txResult.success) {
      log.debug(`remediateSupplier: Stake transaction failed for: ${key.address} ${JSON.stringify(txResult)}`)
      update.state = KeyState.RemediationFailed
      update.remediationHistory = addOrUpdateRemediationHistory(
          {
            ...ownerInitialStakeEntry,
            timestamp: Date.now(),
            txResult: txResult.code,
            txResultDetails: txResult.message,
          },
          remediationHistory
      )
    } else {
      let supplierAfter: Supplier | null = null
      try {
        supplierAfter = await pocketRpcClient.getSupplier(params.address)
      } catch (e) {
        log.warn('remediateSupplier: Failed to re-fetch supplier after stake; keeping remediation entry for verification.', {
          params,
          error: e,
        })
      }

      const nowConfigured =
          supplierAfter
              ? ((supplierAfter.services?.length ?? 0) > 0 || (supplierAfter.serviceConfigHistory?.length ?? 0) > 0)
              : false

      update.state = KeyState.Staked

      if (nowConfigured) {
        update.remediationHistory = remediationHistory.filter((rh) => rh.reason !== RemediationHistoryEntryReason.OwnerInitialStake)
      } else {
        update.remediationHistory = addOrUpdateRemediationHistory(
            {
              ...ownerInitialStakeEntry,
              timestamp: Date.now(),
              txResult: txResult.code,
              txResultDetails: txResult.message,
            },
            remediationHistory
        )
      }
    }

    log.debug('remediateSupplier: Updating supplier', { params, update }) // NOTE: adding the update could result in an error due to BIGINT
    try {
      await dal.keys.updateKey(params.address, update, params.height)
      log.debug('remediateSupplier: Update Supplier done!', { params })
    } catch (e) {
      log.warn('remediateSupplier: Update Supplier failed!', { params, error: e })
      return {
        success: false,
        message: 'Failed while updating the supplier status.',
        keyUpdate: update,
        stakeTxResult: txResult,
      }
    }

    log.info('remediateSupplier: Execution finished', { params })

    return {
      success: txResult.success,
      message: txResult.success ? 'Remediation completed successfully.' : 'Remediation transaction failed.',
      stakeTxResult: txResult,
    }
  }
})
