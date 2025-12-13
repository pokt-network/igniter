'use client';

import React, { useMemo, useState } from "react";
import { Button } from "@igniter/ui/components/button";
import { ActivityHeader } from "@igniter/ui/components/ActivityHeader";
import { ActivityContentLoading } from "@/app/app/stake/components/ActivityContentLoading";
import { getShortAddress, toDateFormat, toCurrencyFormat } from '@igniter/ui/lib/utils'
import { Transaction } from "@igniter/db/middleman/schema";
import { CaretSmallIcon, LoaderIcon } from "@igniter/ui/assets";
import AvatarByString from '@igniter/ui/components/AvatarByString'
import { Operation, UnstakeOperation } from '@/app/detail/TransactionDetail'
import { MessageType } from '@/lib/constants'

export interface UnstakeSuccessStepProps {
  nodeCount: number;
  totalStakeAmount: number;
  transaction: Transaction;
  onClose: () => void;
}

export function UnstakeSuccessStep({ nodeCount, totalStakeAmount, transaction, onClose }: Readonly<UnstakeSuccessStepProps>) {
  const [isShowingTransactionDetails, setIsShowingTransactionDetails] = useState<boolean>(false);
  const [isRedirecting, setIsRedirecting] = useState<boolean>(false);

  const isViewReady = useMemo(() => {
    return nodeCount > 0 && transaction;
  }, [nodeCount, transaction]);

  const operations = JSON.parse(transaction.unsignedPayload).body.messages as Array<Operation>;

  const unstakeOperations: Array<UnstakeOperation> = [];

  for (const operation of operations) {
    if (operation.typeUrl === MessageType.Unstake) {
      unstakeOperations.push(operation)
    }
  }

  return (
    <div className="flex flex-col w-[480px] border-x border-b border-[--black-dividers] bg-[--black-1] p-[33px] rounded-b-[12px] gap-8">
      <ActivityHeader
        title="Scheduled!"
        subtitle="Below are the details of your unstake operation."
        onClose={onClose}
      />

      {!isViewReady && (
        <ActivityContentLoading />
      )}

      {isViewReady && (
        <>
          <div className="relative flex h-[64px] gradient-border-green">
            <div
              className={`absolute inset-0 flex flex-row items-center m-[0.5px] bg-[var(--background)] rounded-[8px] p-[18px_25px] justify-between`}>
              <span className="text-[20px] text-[var(--color-white-3)]">
                Unstake
              </span>
              <span className="flex flex-row items-center gap-2">
                <span className="font-mono text-[20px] text-[var(--color-white-1)]">
                  {toCurrencyFormat(totalStakeAmount / 1e6, 2, 2)}
                </span>
                <span className="font-mono text-[20px] text-[var(--color-white-3)]">
                  $POKT
                </span>
              </span>
            </div>
          </div>
          <div className="flex flex-col bg-[var(--color-slate-2)] p-0 rounded-[8px]">
            <span className="text-[14px] text-[var(--color-white-3)] p-[11px_16px]">
              Unstake is being processed. Your nodes will enter an unbonding period and stop generating rewards. After the unbonding period completes, your staked tokens will automatically return to the owner addresses.
            </span>
          </div>
          <div key="unstake-details" className="flex flex-col p-0 rounded-[8px] border border-[var(--black-dividers)]">
            <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
              <span className="text-[14px] text-[var(--color-white-3)]">
                Timestamp
              </span>
              <span className="text-[14px] text-[var(--color-white-1)]">
                {toDateFormat(transaction.createdAt)}
              </span>
            </span>
            <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
              <span className="text-[14px] text-[var(--color-white-3)]">
                Status
              </span>
              <span className="text-[14px] text-[var(--color-white-1)]">
                {transaction.status}
              </span>
            </span>
            <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
              <span className="flex flex-row items-center gap-2 hover:cursor-pointer"
                onClick={() => setIsShowingTransactionDetails(!isShowingTransactionDetails)}>
                {isShowingTransactionDetails && (
                  <CaretSmallIcon className="transform rotate-90" />
                )}
                {!isShowingTransactionDetails && (
                  <CaretSmallIcon />
                )}
                <span className="text-[14px] text-[var(--color-white-3)]">
                  {`Unstake Node (${unstakeOperations.length})`}
                </span>
              </span>
            </span>
            {isShowingTransactionDetails && unstakeOperations.map((operation, index) => {
              return (
                <span key={`unstake-${index}`}
                  className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
                  <span className="text-[14px] text-[var(--color-white-3)]">
                    Operator Address
                  </span>
                    <span className="flex flex-row items-center text-[14px] text-[var(--color-white-1)]">
                        <AvatarByString string={operation.value.operatorAddress} />
                        <span className="ml-2 font-mono">
                            {getShortAddress(operation.value.operatorAddress, 5)}
                        </span>
                    </span>
                </span>
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
          <LoaderIcon className="animate-spin" />
        )}
        {!isRedirecting && 'Close'}
      </Button>
    </div>
  );
}
