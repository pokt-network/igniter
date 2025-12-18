'use client';

import {useMemo, useState} from "react";
import {Button} from "@igniter/ui/components/button";
import {ActivityHeader} from "@igniter/ui/components/ActivityHeader";
import {ActivityContentLoading} from "@/app/app/stake/components/ActivityContentLoading";
import { amountToPokt, toCompactFormat, toDateFormat } from '@igniter/ui/lib/utils'
import {Transaction} from "@igniter/db/middleman/schema";
import {QuickInfoPopOverIcon} from "@igniter/ui/components/QuickInfoPopOverIcon";
import {CaretSmallIcon, CornerIcon, LoaderIcon} from "@igniter/ui/assets";
import {useApplicationSettings} from "@/app/context/ApplicationSettings";
import {StakeDistributionOffer} from "@/lib/models/StakeDistributionOffer";
import Amount from '@igniter/ui/components/Amount'
import { MessageType } from "@/lib/constants";
import { Operation, SendOperation, StakeOperation } from '@/app/detail/TransactionDetail'

export interface StakeSuccessProps {
    amount: number;
    selectedOffer: StakeDistributionOffer;
    transaction: Transaction;
    onClose: () => void;
}

export function StakeSuccessStep({amount, selectedOffer, transaction, onClose}: Readonly<StakeSuccessProps>) {
    const [isShowingTransactionDetails, setIsShowingTransactionDetails] = useState<boolean>(false);
    const applicationSettings = useApplicationSettings();
    const [isRedirecting, setIsRedirecting] = useState<boolean>(false);

    const isViewReady = useMemo(() => {
        return amount && amount > 0 &&
            applicationSettings;
    }, [amount, applicationSettings]);

    const totalNetworkFee = amountToPokt(transaction?.consumedFee || transaction?.estimatedFee);

    const operations = JSON.parse(transaction.unsignedPayload).body.messages as Array<Operation>
    let operationalFunds = 0
    const stakeOperations: Array<StakeOperation> = []
    const sendOperations: Array<SendOperation> = []

    for (const operation of operations) {
      if (operation.typeUrl === MessageType.Stake) {
        stakeOperations.push(operation)
      } else if (operation.typeUrl === MessageType.Send) {
        sendOperations.push(operation)
        operationalFunds += Number(operation.value.amount.at(0)?.amount || 0)
      }
    }

    operationalFunds = operationalFunds / 1e6

    return (
        <div
            className="flex flex-col w-[480px] border-x border-b border-[--black-dividers] bg-[--black-1] p-[33px] rounded-b-[12px] gap-8">
            <ActivityHeader
                title="Scheduled!"
                subtitle="Below are the details of your stake operation."
                onClose={onClose}
            />

            {!isViewReady && (
                <ActivityContentLoading/>
            )}

            {isViewReady && (
                <>
                    <div className="relative flex h-[64px] gradient-border-green">
                        <div
                            className={`absolute inset-0 flex flex-row items-center m-[0.5px] bg-[var(--background)] rounded-[8px] p-[18px_25px] justify-between`}>
                        <span className="text-[20px] text-[var(--color-white-3)]">
                            Stake
                        </span>
                            <span className="flex flex-row items-center gap-2">
                            <span className="font-mono text-[20px] text-[var(--color-white-1)]">
                              <Amount value={amount} />
                            </span>
                        </span>
                        </div>
                    </div>
                    <div className="flex flex-col bg-[var(--color-slate-2)] p-0 rounded-[8px]">
                        <span className="text-[14px] text-[var(--color-white-3)] p-[11px_16px]">
                            Stake is being processed. Avoid moving funds from your wallet for at least one hour to prevent funding errors.
                        </span>
                        {/*<div className="h-[1px] bg-[var(--slate-dividers)]"/>*/}
                        {/*<div className="p-2">*/}
                        {/*    <Button variant="secondaryBorder" className="w-full">*/}
                        {/*        About Staking*/}
                        {/*    </Button>*/}
                        {/*</div>*/}
                    </div>
                    <div className="flex flex-col p-0 rounded-[8px] border border-[var(--black-dividers)]">
                        {applicationSettings?.fee && applicationSettings?.fee > 0 ? (
                            <span
                                className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
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
                        {/*<span*/}
                        {/*    className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">*/}
                        {/*    <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--color-white-3)]">*/}
                        {/*        <span>*/}
                        {/*            Network Fee*/}
                        {/*        </span>*/}
                        {/*        <QuickInfoPopOverIcon*/}
                        {/*            title="Network Fee"*/}
                        {/*            description="The amount of $POKT that will be charged as a network fee per transaction."*/}
                        {/*            url={''}*/}
                        {/*        />*/}
                        {/*    </span>*/}
                        {/*    <span className="flex flex-row gap-2">*/}
                        {/*        <span className="font-mono text-[14px] text-[var(--color-white-1)]">*/}
                        {/*          <Amount value={totalNetworkFee} />*/}
                        {/*        </span>*/}
                        {/*    </span>*/}
                        {/*</span>*/}
                        <span
                            className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
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
                              <Amount value={operationalFunds} />
                            </span>
                        </span>
                    </span>
                    </div>
                    <div key="stake-details"
                         className="flex flex-col p-0 rounded-[8px] border border-[var(--black-dividers)]">
                    <span
                        className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                    <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--color-white-3)]">
                        <span>
                            Provider Fee
                        </span>
                        <QuickInfoPopOverIcon
                            title="Provider Fee"
                            description="The % of the rewards that the node operator retain for providing the service."
                            url={''}
                        />
                    </span>
                    <span className="text-[14px] text-[var(--color-white-1)]">
                        {selectedOffer.fee}%
                    </span>
                </span>
                        <span
                            className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                            <span className="text-[14px] text-[var(--color-white-3)]">
                                Provider
                            </span>
                            <span className="text-[14px] text-[var(--color-white-1)]">
                                {selectedOffer.name}
                            </span>
                        </span>
                        <span
                            className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                            <span className="text-[14px] text-[var(--color-white-3)]">
                                Timestamp
                            </span>
                            <span className="text-[14px] text-[var(--color-white-1)]">
                                {toDateFormat(transaction.createdAt)}
                            </span>
                        </span>
                        <span
                            className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                            <span className="text-[14px] text-[var(--color-white-3)]">
                                Status
                            </span>
                            <span className="text-[14px] text-[var(--color-white-1)]">
                                {transaction.status}
                            </span>
                        </span>
                        <span
                            className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                        <span className="flex flex-row items-center gap-2 hover:cursor-pointer"
                          onClick={() => setIsShowingTransactionDetails(!isShowingTransactionDetails)}>
                        {isShowingTransactionDetails && (
                            <CaretSmallIcon className="transform rotate-90"/>
                        )}
                        {!isShowingTransactionDetails && (
                            <CaretSmallIcon/>
                        )}
                        <span className="text-[14px] text-[var(--color-white-3)]">
                            {`Operations (${operations.length})`}
                        </span>
                    </span>
                </span>
                      {isShowingTransactionDetails && stakeOperations.map((operation, index) => {
                        const operationalFund = sendOperations.find(op => op.value.toAddress === operation.value.operatorAddress)
                        return (
                          <>
                              <span key={`stake-${index}`}
                                    className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                                  <span className="text-[14px] text-[var(--color-white-3)]">
                                      Stake {toCompactFormat(amountToPokt(operation.value.stake.amount))}
                                  </span>
                                  <span className="flex flex-row gap-2">
                                      <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                                        <Amount value={amountToPokt(operation.value.stake.amount || 0)} />
                                      </span>
                                  </span>
                              </span>
                            {operationalFund && (
                              <span
                                key={`dependant-tx-${index}`}
                                className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]"
                              >
                                  <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--color-white-3)]">
                                      <CornerIcon/>
                                      <span>
                                          Operational Funds
                                      </span>
                                  </span>
                                  <span className="flex flex-row gap-2">
                                      <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                                        <Amount value={amountToPokt(operationalFund.value.amount.at(0)!.amount)} />
                                      </span>
                                  </span>
                              </span>
                            )}
                          </>
                        )
                      })}
                  </div>
                </>
            )}

            <Button
                className="w-full h-[40px]"
                onClick={() => {
                    setIsRedirecting(true);
                    onClose();
                }}
            >
                {isRedirecting && (
                    <LoaderIcon className="animate-spin"/>
                )}
                {!isRedirecting && 'Close'}
            </Button>
        </div>
    );
}
