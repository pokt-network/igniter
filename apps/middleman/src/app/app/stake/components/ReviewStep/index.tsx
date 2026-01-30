'use client';

import type { SupplierStake, TransactionMessage } from '@/lib/models/Transactions'
import { useQuery } from '@tanstack/react-query'
import { ActivityHeader } from '@igniter/ui/components/ActivityHeader'
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index'
import { Skeleton } from '@igniter/ui/components/skeleton'
import { Button } from '@igniter/ui/components/button'
import { GetSupplierStakingFee, SimulateFee } from '@/actions/Blockchain'
import { requestSuppliers } from '@/lib/services/provider'
import { StakeDistributionOffer } from '@/lib/models/StakeDistributionOffer'
import { getShortAddress, toCurrencyFormat } from '@igniter/ui/lib/utils'
import { QuickInfoPopOverIcon } from '@igniter/ui/components/QuickInfoPopOverIcon'
import { CaretSmallIcon, CornerIcon } from '@igniter/ui/assets'
import React, { useMemo, useState } from 'react'
import { useApplicationSettings } from '@/app/context/ApplicationSettings'
import { StakingProcess, StakingProcessStatus } from '@/app/app/stake/components/ReviewStep/StakingProcess'
import { Transaction } from '@igniter/db/middleman/schema'
import AvatarByString from '@igniter/ui/components/AvatarByString'
import { calculateShares } from '@/lib/utils/shareCalculations'
import { PlanDetailsSection } from '@/app/app/stake/components/PlanDetailsSection'

function useSimulateFee(
  selectedOffer: StakeDistributionOffer,
  selectedAddressGroupId: number,
  ownerAddress: string,
) {
    const {getPublicKey} = useWalletConnection()
    const settings = useApplicationSettings();

    return useQuery({
        queryKey: ['simulate-fee', selectedOffer, selectedAddressGroupId, ownerAddress],
        queryFn: async () => {
            const pubKey = await getPublicKey(ownerAddress)

            const suppliers = await requestSuppliers(
              selectedAddressGroupId,
              selectedOffer,
              settings!,
              ownerAddress,
              undefined,
              true
            );

            const messages: Array<TransactionMessage> = []

            for (const supplier of suppliers) {
                messages.push(
                  {
                      typeUrl: '/pocket.supplier.MsgStakeSupplier',
                      body: {
                          ...supplier,
                          // owner can't no longer change the services, not even in the first stake
                          services: [],
                          stakeAmount: (Number(supplier.stakeAmount) * 1e6).toString(),
                          ownerAddress: ownerAddress,
                          signer: ownerAddress,
                      }
                  },
                  {
                      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
                      body: {
                          // @ts-ignore
                          fromAddress: ownerAddress,
                          toAddress: supplier.operatorAddress,
                          amount: (selectedOffer.operationalFundsAmount * 1e6).toString(),
                      },
                  }
                )
            }

            return await SimulateFee({
                messages,
                signerPubKey: pubKey,
            })
        }
    })
}

function useStakeSupplierFee() {
    return useQuery({
        queryKey: ['stake-supplier-fee'],
        queryFn: GetSupplierStakingFee,
    })
}

function useBalance(ownerAddress: string) {
    const {getBalance} = useWalletConnection()

    return useQuery({
        queryKey: ['balance', ownerAddress],
        queryFn: () => {
            return getBalance(ownerAddress)
        },
    })
}

function useBalanceAndNetworkFee(
  selectedOffer: StakeDistributionOffer,
  selectedAddressGroupId: number,
  ownerAddress: string,
  amount: number,
) {
    const {
        data: simulateFee,
        isLoading: isLoadingSimulateFee,
        isError: errorSimulateFee,
        refetch: refetchSimulateFee,
    } = useSimulateFee(selectedOffer, selectedAddressGroupId, ownerAddress)
    const {
        data: stakeSupplierFee,
        isLoading: isLoadingStakeSupplierFee,
        isError: errorStakeSupplierFee,
        refetch: refetchStakeSupplierFee,
    } = useStakeSupplierFee()
    const {
        data: balance,
        isError: errorBalance,
        isLoading: isLoadingBalance,
        refetch: refetchBalance,
    } = useBalance(ownerAddress)


    const suppliersToBeStaked = selectedOffer.stakeDistribution.reduce((acc, stakeDistribution) => acc + stakeDistribution.qty, 0)
    const operationalFunds = suppliersToBeStaked * selectedOffer.operationalFundsAmount

    const totalNetworkFee = (simulateFee?.fee || 0) + (stakeSupplierFee || 0) * suppliersToBeStaked

    const balanceCoversTotal = (balance || 0) > amount + totalNetworkFee + operationalFunds

    return {
        isLoadingFee: isLoadingSimulateFee || isLoadingStakeSupplierFee,
        errorFee: errorSimulateFee || errorStakeSupplierFee,
        refetchFee: () => {
            if (errorSimulateFee) {
                refetchSimulateFee()
            }

            if (errorStakeSupplierFee) {
                refetchStakeSupplierFee()
            }
        },
        networkFee: totalNetworkFee,
        balance: balance || 0,
        isLoadingBalance,
        errorBalance,
        refetchBalance,
        balanceCoversTotal,
    }
}

export interface ReviewStepProps {
    amount: number;
    selectedOffer: StakeDistributionOffer;
    selectedAddressGroupId: number;
    errorMessage?: string;
    ownerAddress: string;
    onStakeCompleted: (status: StakingProcessStatus, transaction?: Transaction) => void;
    onSuppliersReceived: (suppliers: SupplierStake[]) => void;
    onBack: () => void;
    onClose: () => void;
    ownerWasPreselected?: boolean;
}

export function ReviewStep({onStakeCompleted, amount, selectedOffer, selectedAddressGroupId, ownerAddress, errorMessage, onSuppliersReceived, onBack, onClose, ownerWasPreselected}: Readonly<ReviewStepProps>) {
    const {
        isLoadingFee,
        errorFee,
        networkFee,
        refetchFee,
        balance,
        isLoadingBalance,
        errorBalance,
        refetchBalance,
        balanceCoversTotal
    } = useBalanceAndNetworkFee(
      selectedOffer,
      selectedAddressGroupId,
      ownerAddress,
      amount,
    )

    const [isShowingTransactionDetails, setIsShowingTransactionDetails] = useState<boolean>(false);
    const applicationSettings = useApplicationSettings();

    const selectedAddressGroup = selectedOffer.addressGroups.find(ag => ag.id === selectedAddressGroupId);
    const delegatorFee = applicationSettings?.fee ? Number(applicationSettings.fee) : 0;
    const shares = selectedAddressGroup ? calculateShares(selectedAddressGroup, delegatorFee) : null;

    const prospectTransactions = useMemo(() => {
        return selectedOffer.stakeDistribution.reduce<number[]>((txs, stakeDistribution) => {
            return [...txs, ...Array.from({length: stakeDistribution.qty}, () => stakeDistribution.amount)];
        }, []);
    }, [selectedOffer]);

    const totalTransactionsToSign = useMemo(() => {
        return prospectTransactions.length * 2;
    }, [prospectTransactions])

    const nodes = applicationSettings?.minimumStake ? amount / applicationSettings.minimumStake : 0;
    const operationalFunds = nodes * selectedOffer.operationalFundsAmount;

    return (
        <div
            className="flex flex-col w-[580px] border-x border-b border-[--balck-deviders] bg-[--black-1] p-[33px] rounded-b-[12px] gap-8">
            <ActivityHeader
                onBack={onBack}
                onClose={onClose}
                title="Review"
                subtitle="Please review the details of your stake operation."
            />

            <div className="relative flex h-[64px] min-h-[64px] gradient-border-slate">
                <div className={`absolute inset-0 flex flex-row items-center m-[0.5px] bg-[var(--background)] rounded-[8px] p-[18px_25px] justify-between`}>
                    <span className="text-[20px] text-[var(--color-white-3)]">
                        Stake
                    </span>
                    <span className="flex flex-row items-center gap-2">
                        <span className="font-mono text-[20px] text-[var(--color-white-1)]">
                            {toCurrencyFormat(amount, 2, 2)}
                        </span>
                        <span className="font-mono text-[20px] text-[var(--color-white-3)]">
                            $POKT
                        </span>
                    </span>
                </div>
            </div>

            <div className="flex flex-col bg-[var(--color-slate-2)] p-0 rounded-[8px]">
                {!errorMessage && (
                  <span className="text-[14px] text-[var(--color-white-3)] p-[11px_16px]">
                    Upon clicking Stake, you will be prompted to sign transactions with your wallet to finalize the stake operation.
                  </span>
                )}
                {errorMessage && (
                  <span className="text-[14px] text-[var(--color-white-3)] p-[11px_16px]">
                    {errorMessage}
                  </span>
                )}
                {/*<div className="h-[1px] bg-[var(--slate-dividers)]" />*/}
                {/*<div className="p-2">*/}
                {/*    <Button variant="secondaryBorder" className="w-full">*/}
                {/*        About Staking*/}
                {/*    </Button>*/}
                {/*</div>*/}
            </div>

            <div className="flex flex-col p-0 rounded-[8px] border border-[var(--black-dividers)]">
                {applicationSettings?.fee && applicationSettings?.fee > 0 ? (
                    <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                        <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--color-white-3)]">
                            <span>
                                Service Fee
                            </span>
                            <QuickInfoPopOverIcon
                                title="Service Fee"
                                description="The % of the rewards that this website retain for handling the service."
                                url={''}
                            />
                        </span>
                        <span className="text-[14px] text-[var(--color-white-1)]">
                            {applicationSettings?.fee}%
                        </span>
                    </span>
                ) : null}
                <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                    <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--color-white-3)]">
                        <span>
                            Network Fee
                        </span>
                        <QuickInfoPopOverIcon
                            title="Network Fee"
                            description="The amount of $POKT that will be charged as a network fee per transaction."
                            url={''}
                        />
                    </span>
                    {isLoadingFee ? (
                      <Skeleton className="w-[100px] h-5 bg-gray-700" />
                    ) : errorFee ? (
                      <span className={'text-sm'}>Failed to fetch <Button onClick={refetchFee} className={'ml-1 h-[30px]'}>Retry</Button></span>
                    ): (
                      <span className="flex flex-row gap-2">
                        <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                            {toCurrencyFormat(networkFee, 6, 2)}
                        </span>
                        <span className="font-mono text-[14px] text-[var(--color-white-3)]">
                            $POKT
                        </span>
                    </span>
                    )}
                </span>
                <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                    <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--color-white-3)]">
                        <span>
                            Operational Funds
                        </span>
                        <QuickInfoPopOverIcon
                            title="Operational Funds"
                            description="Small amount of $POKT required per node to process relays."
                            url={''}
                        />
                    </span>
                    <span className="flex flex-row gap-2">
                        <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                            {toCurrencyFormat(operationalFunds, 2, 2)}
                        </span>
                        <span className="font-mono text-[14px] text-[var(--color-white-3)]">
                            $POKT
                        </span>
                    </span>
                </span>
                <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                    <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--color-white-3)]">
                        <span>
                            Total
                        </span>
                        <QuickInfoPopOverIcon
                          title="Total"
                          description="The amount of $POKT that you will spend staking your nodes."
                          url={''}
                        />
                    </span>
                    {isLoadingFee ? (
                      <Skeleton className="w-[100px] h-5 bg-gray-700" />
                    ) : errorFee ? (
                        <span className={'text-sm'}>Failed to fetch <Button onClick={refetchFee} className={'ml-1 h-[30px]'}>Retry</Button></span>
                    ): (
                      <span className="flex flex-row gap-2">
                        <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                            {toCurrencyFormat(networkFee + amount + operationalFunds, 6, 2)}
                        </span>
                        <span className="font-mono text-[14px] text-[var(--color-white-3)]">
                            $POKT
                        </span>
                    </span>
                    )}
                </span>
                <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                    <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--color-white-3)]">
                        <span>
                            Balance
                        </span>
                        <QuickInfoPopOverIcon
                          title="Balance"
                          description="The amount of $POKT that you have available."
                          url={''}
                        />
                    </span>
                    {isLoadingBalance ? (
                      <Skeleton className="w-[100px] h-5 bg-gray-700" />
                    ) : errorBalance ? (
                        <span className={'text-sm'}>Failed to fetch <Button onClick={() => refetchBalance()} className={'ml-1 h-[30px]'}>Retry</Button></span>
                    ): (
                      <span className="flex flex-row gap-2">
                        <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                            {toCurrencyFormat(balance, 6, 2)}
                        </span>
                        <span className="font-mono text-[14px] text-[var(--color-white-3)]">
                            $POKT
                        </span>
                    </span>
                    )}
                </span>
            </div>

            {!balanceCoversTotal && !!balance && !!networkFee && (
              <div className="flex flex-col bg-[#f4424257] p-0 rounded-[8px]">
                <span className="text-[14px] font-medium text-[var(--color-white-1)] p-[11px_16px]">
                    Oops. It looks like you don't have enough $POKT to cover the total amount of stake.
                    <br/>
                    <br/>
                     You won't be able to stake your nodes until you have enough $POKT to cover the total amount of stake.
                </span>
              </div>
            )}


            <div key="stake-details" className="flex flex-col p-0 rounded-[8px] border border-[var(--black-dividers)]">
                <div className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                    <span className="text-[14px] text-[var(--color-white-3)]">
                        Nodes
                    </span>
                    <span className="flex flex-row gap-1">
                        <span className={'text-[14px] font-mono text-[var(--color-white-1)]'}>
                            {nodes}
                        </span>
                    </span>
                </div>
                <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                    <span className="text-[14px] text-[var(--color-white-3)]">
                        Provider
                    </span>
                    <span className="text-[14px] text-[var(--color-white-1)]">
                        {selectedOffer.name}
                    </span>
                </span>
                {selectedAddressGroup && shares && (
                    <>
                        <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                            <span className="text-[14px] text-[var(--color-white-3)]">
                                Plan
                            </span>
                            <span className="text-[14px] text-[var(--color-white-1)]">
                                {selectedAddressGroup.name}
                            </span>
                        </span>
                        <PlanDetailsSection
                            addressGroupName={selectedAddressGroup.name}
                            services={selectedAddressGroup.addressGroupServices}
                            shares={shares}
                            delegatorFee={delegatorFee}
                        />
                    </>
                )}
                {/*TODO: Only show this when there are more than one connected identity? or when the owner address is different than the connected identity signed in?*/}
                <span className="flex flex-col px-4 py-3 border-b border-[var(--black-dividers)]">
                    <span className="flex flex-row items-center w-full justify-between">
                        <span className="text-[14px] text-[var(--color-white-3)]">
                            Owner Address
                        </span>
                        <span className="flex flex-row items-center text-[14px] text-[var(--color-white-1)]">
                            <AvatarByString string={ownerAddress} />
                            <span className="ml-2 font-mono">
                                {getShortAddress(ownerAddress, 5)}
                            </span>
                        </span>
                    </span>
                    {ownerWasPreselected && (
                      <span className={'text-xs text-left text-purple-300 opacity-90'}>
                        Preselected because the plan you chose is linked to this wallet.
                      </span>
                    )}
                </span>

                <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                    <span className="flex flex-row items-center gap-2 hover:cursor-pointer" onClick={() => setIsShowingTransactionDetails(!isShowingTransactionDetails)}>
                        {isShowingTransactionDetails && (
                            <CaretSmallIcon className="transform rotate-90" />
                        )}
                        {!isShowingTransactionDetails && (
                            <CaretSmallIcon />
                        )}
                        <span className="text-[14px] text-[var(--color-white-3)]">
                            {`Operations (${totalTransactionsToSign})`}
                        </span>
                    </span>
                </span>
                {isShowingTransactionDetails && prospectTransactions.map((tx, index) => (
                    <React.Fragment key={index}>
                        <span key={`stake-${index}`} className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                            <span className="text-[14px] text-[var(--color-white-3)]">
                                {`Stake`}
                            </span>
                            <span className="flex flex-row gap-2">
                                <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                                    {toCurrencyFormat(tx, 2, 2)}
                                </span>
                                <span className="font-mono text-[14px] text-[var(--color-white-3)]">
                                    $POKT
                                </span>
                            </span>
                        </span>
                        <span key={`of-${index}`} className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                            <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--color-white-3)]">
                                <CornerIcon />
                                <span>
                                    Operational Funds
                                </span>
                            </span>
                            <span className="flex flex-row gap-2">
                                <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                                    {toCurrencyFormat(selectedOffer.operationalFundsAmount, 2, 2)}
                                </span>
                                <span className="font-mono text-[14px] text-[var(--color-white-3)]">
                                    $POKT
                                </span>
                            </span>
                        </span>
                    </React.Fragment>
                ))}
            </div>

            <StakingProcess
              disabled={isLoadingFee || errorFee || isLoadingBalance || errorBalance || !balanceCoversTotal}
              ownerAddress={ownerAddress}
              offer={selectedOffer}
              onStakeCompleted={onStakeCompleted}
              onSuppliersReceived={onSuppliersReceived}
              selectedAddressGroupId={selectedAddressGroupId}
            />
        </div>
    );
}
