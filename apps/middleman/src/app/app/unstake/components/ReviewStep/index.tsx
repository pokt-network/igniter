'use client';

import { ActivityHeader } from "@igniter/ui/components/ActivityHeader";
import { Button } from "@igniter/ui/components/button";
import { Skeleton } from "@igniter/ui/components/skeleton";
import { QuickInfoPopOverIcon } from "@igniter/ui/components/QuickInfoPopOverIcon";
import { CaretSmallIcon, CornerIcon } from "@igniter/ui/assets";
import { useQuery } from "@tanstack/react-query";
import { GetUserNodes } from "@/actions/Nodes";
import { GetUnstakeDuration } from "@/actions/Unstake";
import { formatDuration } from "@/lib/utils/time";
import { useMemo, useState } from "react";
import { getShortAddress, toCurrencyFormat } from "@igniter/ui/lib/utils";
import AvatarByString from "@igniter/ui/components/AvatarByString";
import { UnstakingProcess, UnstakingProcessStatus } from "@/app/app/unstake/components/ReviewStep/UnstakingProcess";
import { Transaction } from "@igniter/db/middleman/schema";
import React from "react";

export interface ReviewStepProps {
  selectedNodeAddresses: string[];
  ownerAddress: string;
  errorMessage?: string;
  onUnstakeCompleted: (status: UnstakingProcessStatus, transaction?: Transaction) => void;
  onBack: () => void;
  onClose: () => void;
}

interface OwnerAddressGroup {
  ownerAddress: string;
  nodes: Array<{
    address: string;
    stakeAmount: string;
    provider?: { name?: string | null } | null;
  }>;
  totalStake: number;
}

export function ReviewStep({
  selectedNodeAddresses,
  ownerAddress,
  errorMessage,
  onUnstakeCompleted,
  onBack,
  onClose
}: Readonly<ReviewStepProps>) {
  const [isShowingNodeDetails, setIsShowingNodeDetails] = useState(false);

  const {
    data: nodes,
    isLoading: isLoadingNodes,
    isError: isErrorNodes,
    refetch: refetchNodes,
  } = useQuery({
    queryKey: ['user-nodes'],
    queryFn: GetUserNodes,
  });

  const {
    data: unstakeDurationData,
    isLoading: isLoadingDuration,
    isError: isErrorDuration,
    refetch: refetchDuration,
  } = useQuery({
    queryKey: ['unstake-duration'],
    queryFn: GetUnstakeDuration,
  });

  const selectedNodes = useMemo(() => {
    if (!nodes) return [];
    return nodes.filter(node => selectedNodeAddresses.includes(node.address));
  }, [nodes, selectedNodeAddresses]);

  // Group nodes by owner address
  const ownerAddressGroups = useMemo(() => {
    const groups = new Map<string, OwnerAddressGroup>();

    selectedNodes.forEach(node => {
      const existing = groups.get(node.ownerAddress);
      const stakeAmount = parseFloat(node.stakeAmount);

      if (existing) {
        existing.nodes.push({
          address: node.address,
          stakeAmount: node.stakeAmount,
          provider: node.provider,
        });
        existing.totalStake += stakeAmount;
      } else {
        groups.set(node.ownerAddress, {
          ownerAddress: node.ownerAddress,
          nodes: [{
            address: node.address,
            stakeAmount: node.stakeAmount,
            provider: node.provider,
          }],
          totalStake: stakeAmount,
        });
      }
    });

    return Array.from(groups.values());
  }, [selectedNodes]);

  const totalStakeAmount = useMemo(() => {
    return selectedNodes.reduce((sum, node) => sum + parseFloat(node.stakeAmount), 0);
  }, [selectedNodes]);

  const totalTransactions = ownerAddressGroups.length;

  const formattedDuration = unstakeDurationData ? formatDuration(unstakeDurationData.durationSeconds) : null;

  const isLoading = isLoadingNodes || isLoadingDuration;
  const isError = isErrorNodes || isErrorDuration;

  return (
    <div className="flex flex-col w-[480px] border-x border-b border-[--black-dividers] bg-[--black-1] p-[33px] rounded-b-[12px] gap-8">
      <ActivityHeader
        onBack={onBack}
        onClose={onClose}
        title="Review"
        subtitle="Please review the details of your unstake operation."
      />

      <div className="flex flex-col bg-[var(--color-slate-2)] p-0 rounded-[8px]">
        {!errorMessage && (
          <span className="text-[14px] text-[var(--color-white-3)] p-[11px_16px]">
            Upon clicking Unstake, you will be prompted to sign a transaction with your wallet to finalize the unstake operation.
            {formattedDuration && (
              <>
                {' '}After approximately <span className="font-mono text-[var(--color-white-1)]">{formattedDuration}</span>, your tokens will be returned to the owner address.
              </>
            )}
          </span>
        )}
        {errorMessage && (
          <span className="text-[14px] text-[var(--color-white-3)] p-[11px_16px]">
            {errorMessage}
          </span>
        )}
      </div>

      <div className="relative flex h-[64px] min-h-[64px] gradient-border-slate">
        <div className="absolute inset-0 flex flex-row items-center m-[0.5px] bg-[var(--background)] rounded-[8px] p-[18px_25px] justify-between">
          <span className="text-[20px] text-[var(--color-white-3)]">
            Unstake
          </span>
          <span className="flex flex-row items-center gap-2">
            {isLoadingNodes ? (
              <Skeleton className="w-[100px] h-6 bg-gray-700" />
            ) : (
              <>
                <span className="font-mono text-[20px] text-[var(--color-white-1)]">
                  {toCurrencyFormat(totalStakeAmount / 1e6, 2, 2)}
                </span>
                <span className="font-mono text-[20px] text-[var(--color-white-3)]">
                  $POKT
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      {isError && (
        <div className="flex flex-col bg-[#f4424257] p-0 rounded-[8px]">
          <span className="text-[14px] font-medium text-[var(--color-white-1)] p-[11px_16px]">
            Failed to load unstake information.
            <div className="flex gap-2 mt-2">
              {isErrorNodes && (
                <Button onClick={() => refetchNodes()} className="h-[30px]">
                  Retry Nodes
                </Button>
              )}
              {isErrorDuration && (
                <Button onClick={() => refetchDuration()} className="h-[30px]">
                  Retry Duration
                </Button>
              )}
            </div>
          </span>
        </div>
      )}

      <div className="flex flex-col p-0 rounded-[8px] border border-[var(--black-dividers)]">
        {/* Owner Address Groups */}
        {ownerAddressGroups.map((group, index) => (
          <React.Fragment key={group.ownerAddress}>
            <div className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
              <div className="flex flex-row items-center gap-2">
                <span className="text-[14px] text-[var(--color-white-3)]">
                  Owner Address
                </span>
                <QuickInfoPopOverIcon
                  title="Owner Address"
                  description="The address that will receive the unstaked tokens."
                  url=""
                />
              </div>
              <span className="flex flex-row items-center text-[14px] text-[var(--color-white-1)]">
                <AvatarByString string={group.ownerAddress} />
                <span className="ml-2 font-mono">
                  {getShortAddress(group.ownerAddress, 5)}
                </span>
              </span>
            </div>

            <div className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
              <span className="text-[14px] text-[var(--color-white-3)]">
                Tokens to Receive
              </span>
              {isLoadingNodes ? (
                <Skeleton className="w-[100px] h-5 bg-gray-700" />
              ) : (
                <span className="flex flex-row gap-2">
                  <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                    {toCurrencyFormat(group.totalStake / 1e6, 2, 2)}
                  </span>
                  <span className="font-mono text-[14px] text-[var(--color-white-3)]">
                    $POKT
                  </span>
                </span>
              )}
            </div>

            <div className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
              <span className="text-[14px] text-[var(--color-white-3)]">
                Nodes
              </span>
              <span className="text-[14px] text-[var(--color-white-1)]">
                {group.nodes.length}
              </span>
            </div>

            {index < ownerAddressGroups.length - 1 && (
              <div className="h-[8px] bg-[var(--black-1)]" />
            )}
          </React.Fragment>
        ))}

        {/* Node Details Expandable */}
        <div className="border-t-2 border-[var(--black-dividers)]">
          <div
            className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)] hover:cursor-pointer"
            onClick={() => setIsShowingNodeDetails(!isShowingNodeDetails)}
          >
            <span className="flex flex-row items-center gap-2">
              {isShowingNodeDetails ? (
                <CaretSmallIcon className="transform rotate-90" />
              ) : (
                <CaretSmallIcon />
              )}
              <span className="text-[14px] text-[var(--color-white-3)]">
                Node Details ({selectedNodeAddresses.length} nodes)
              </span>
            </span>
          </div>

          {isShowingNodeDetails && (
            <>
              {isLoadingNodes && (
                <div className="flex flex-col gap-2 p-4">
                  <Skeleton className="w-full h-12 bg-gray-700" />
                  <Skeleton className="w-full h-12 bg-gray-700" />
                </div>
              )}

              {!isLoadingNodes && ownerAddressGroups.map((group) => (
                <React.Fragment key={`details-${group.ownerAddress}`}>
                  {group.nodes.map((node, nodeIndex) => (
                    <div
                      key={node.address}
                      className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]"
                    >
                      <div className="flex flex-row items-center gap-2">
                        <CornerIcon />
                        <AvatarByString string={node.address} />
                        <div className="flex flex-col">
                          <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                            {getShortAddress(node.address, 5)}
                          </span>
                          <span className="text-[12px] text-[var(--color-white-3)]">
                            {node.provider?.name || 'Unknown Provider'}
                          </span>
                        </div>
                      </div>
                      <span className="flex flex-row gap-1">
                        <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                          {toCurrencyFormat(parseFloat(node.stakeAmount) / 1e6, 2, 2)}
                        </span>
                        <span className="font-mono text-[14px] text-[var(--color-white-3)]">
                          $POKT
                        </span>
                      </span>
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </>
          )}
        </div>

        {/* Total */}
        <div className="flex flex-row items-center justify-between px-4 py-3 bg-[var(--color-slate-2)]">
          <span className="text-[14px] font-medium text-[var(--color-white-3)]">
            Total
          </span>
          {isLoadingNodes ? (
            <Skeleton className="w-[100px] h-5 bg-gray-700" />
          ) : (
            <span className="flex flex-row gap-2">
              <span className="font-mono text-[14px] font-medium text-[var(--color-white-1)]">
                {toCurrencyFormat(totalStakeAmount / 1e6, 2, 2)}
              </span>
              <span className="font-mono text-[14px] text-[var(--color-white-3)]">
                $POKT
              </span>
            </span>
          )}
        </div>
      </div>

      <UnstakingProcess
        disabled={isLoading || isError}
        selectedNodeAddresses={selectedNodeAddresses}
        ownerAddress={ownerAddress}
        onUnstakeCompleted={onUnstakeCompleted}
      />
    </div>
  );
}
