'use client';

import { ActivityHeader } from "@igniter/ui/components/ActivityHeader";
import { Button } from "@igniter/ui/components/button";
import { Skeleton } from "@igniter/ui/components/skeleton";
import { QuickInfoPopOverIcon } from "@igniter/ui/components/QuickInfoPopOverIcon";
import { useWalletConnection } from "@igniter/ui/context/WalletConnection/index";
import { CaretSmallIcon, CornerIcon } from "@igniter/ui/assets";
import { useQuery } from "@tanstack/react-query";
import { GetUnstakeDuration } from "@/actions/Unstake";
import { SimulateFee } from "@/actions/Blockchain";
import type { TransactionMessage } from "@/lib/models/Transactions";
import { GetUserNodes } from "@/actions/Nodes";
import { formatDuration } from "@/lib/utils/time";
import { useMemo, useState } from "react";
import { toCurrencyFormat, amountToPokt } from "@igniter/ui/lib/utils";
import AvatarByString from "@igniter/ui/components/AvatarByString";
import Address from "@igniter/ui/components/Address";
import { UnstakingProcess, UnstakingProcessStatus } from "@/app/app/unstake/components/ReviewStep/UnstakingProcess";
import { Transaction } from "@igniter/db/middleman/schema";
import React from "react";

type UserNodes = Awaited<ReturnType<typeof GetUserNodes>>;

export interface ReviewStepProps {
  nodes: UserNodes | undefined;
  isLoadingNodes: boolean;
  isErrorNodes: boolean;
  onRetryNodes: () => void;
  selectedNodeAddresses: string[];
  ownerAddress: string;
  errorMessage?: string;
  onUnstakeCompleted: (status: UnstakingProcessStatus, transaction?: Transaction) => void;
  onBack?: () => void;
  onClose: () => void;
}

interface OwnerAddressGroup {
  ownerAddress: string;
  nodes: Array<{
    address: string;
    stakeAmount: string;
    balance: number;
    provider?: { name?: string | null } | null;
  }>;
  totalStake: number;
}

function useUnstakeNetworkFee(selectedNodeAddresses: string[], ownerAddress: string) {
  const { getPublicKey } = useWalletConnection()
  return useQuery({
    queryKey: ['unstake-simulate-fee', ownerAddress, selectedNodeAddresses],
    enabled: selectedNodeAddresses.length > 0 && !!ownerAddress,
    queryFn: async () => {
      const pubKey = await getPublicKey(ownerAddress)
      const messages: TransactionMessage[] = selectedNodeAddresses.map((operatorAddress) => ({
        typeUrl: '/pocket.supplier.MsgUnstakeSupplier',
        body: { operatorAddress, signer: ownerAddress },
      }))
      return await SimulateFee({ messages, signerPubKey: pubKey })
    },
  })
}

export function ReviewStep({
  nodes,
  isLoadingNodes,
  isErrorNodes,
  onRetryNodes,
  selectedNodeAddresses,
  ownerAddress,
  errorMessage,
  onUnstakeCompleted,
  onBack,
  onClose
}: Readonly<ReviewStepProps>) {
  const [isShowingNodeDetails, setIsShowingNodeDetails] = useState(false);

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
          balance: Number(node.balance ?? 0),
          provider: node.provider,
        });
        existing.totalStake += stakeAmount;
      } else {
        groups.set(node.ownerAddress, {
          ownerAddress: node.ownerAddress,
          nodes: [{
            address: node.address,
            stakeAmount: node.stakeAmount,
            balance: Number(node.balance ?? 0),
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

  // Collect unique providers from selected nodes with their return-funds policy and the
  // residual operator balance the return-funds drain would move to the owner. The exact
  // amount can't be known up front: the unstake fee is gas-based, and when funds ARE
  // returned a second (return-funds) fee applies — so this is shown as an approximation.
  const uniqueProviders = useMemo(() => {
    const map = new Map<string, { identity: string; name: string; returnSupplierFundsToOwner: boolean; residualUpokt: number }>();
    for (const node of selectedNodes) {
      if (!node.provider || !node.provider.identity) continue;
      const balance = Number(node.balance ?? 0);
      const existing = map.get(node.provider.identity);
      if (existing) {
        existing.residualUpokt += balance;
      } else {
        map.set(node.provider.identity, {
          identity: node.provider.identity,
          name: node.provider.name,
          returnSupplierFundsToOwner: node.provider.returnSupplierFundsToOwner,
          residualUpokt: balance,
        });
      }
    }
    return Array.from(map.values());
  }, [selectedNodes]);

  const formattedDuration = unstakeDurationData ? formatDuration(unstakeDurationData.durationSeconds) : null;

  const isLoading = isLoadingNodes || isLoadingDuration;
  const isError = isErrorNodes || isErrorDuration;

  const {
    data: networkFeeData,
    isLoading: isLoadingNetworkFee,
    isError: isErrorNetworkFee,
    refetch: refetchNetworkFee,
  } = useUnstakeNetworkFee(selectedNodeAddresses, ownerAddress);

  return (
    <div className="flex flex-col w-[480px] border-x border-b border-border-primary bg-bg-root p-6 rounded-b-[12px] gap-4">
      <ActivityHeader
        onBack={onBack}
        onClose={onClose}
        title="Review"
        subtitle="Please review the details of your unstake operation."
      />

      {errorMessage && (
        <div className="flex flex-col bg-[var(--bg-surface)] rounded-[8px]">
          <span className="text-[14px] text-[var(--text-tertiary)] p-[11px_16px]">
            {errorMessage}
          </span>
        </div>
      )}

      {/* Unstake amount */}
      <div className="relative flex h-[56px] min-h-[56px] gradient-border-slate">
        <div className="absolute inset-0 flex flex-row items-center m-[0.5px] bg-[var(--background)] rounded-[8px] p-[14px_20px] justify-between">
          <span className="text-[18px] text-white">
            Unstake
          </span>
          <span className="flex flex-row items-center gap-2">
            {isLoadingNodes ? (
              <Skeleton className="w-[100px] h-6 bg-bg-elevated" />
            ) : (
              <>
                <span className="font-mono text-[18px] text-white">
                  {toCurrencyFormat(totalStakeAmount / 1e6, 2, 2)}
                </span>
                <span className="font-mono text-[18px] text-white/60">
                  $POKT
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      {isError && (
        <div className="flex flex-col bg-error-bg p-0 rounded-[8px]">
          <span className="text-[14px] font-medium text-[var(--text-primary)] p-[11px_16px]">
            Failed to load unstake information.
            <div className="flex gap-2 mt-2">
              {isErrorNodes && (
                <Button onClick={onRetryNodes} className="h-[30px]">
                  Retry Suppliers
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

      <div className="flex flex-col p-0 rounded-[8px] border border-[var(--border-primary)]">
        {/* Owner Address Groups */}
        {ownerAddressGroups.map((group, index) => (
          <React.Fragment key={group.ownerAddress}>
            <div className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--border-primary)]">
              <div className="flex flex-row items-center gap-2">
                <span className="text-[14px] text-[var(--text-tertiary)]">
                  Owner Address
                </span>
                <QuickInfoPopOverIcon
                  title="Owner Address"
                  description="The address that will receive the unstaked tokens."
                  url=""
                />
              </div>
              <Address address={group.ownerAddress} showAvatar />
            </div>

            <div className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--border-primary)]">
              <span className="text-[14px] text-[var(--text-tertiary)]">
                Tokens to Receive
              </span>
              {isLoadingNodes ? (
                <Skeleton className="w-[100px] h-5 bg-bg-elevated" />
              ) : (
                <span className="flex flex-row gap-2">
                  <span className="font-mono text-[14px] text-[var(--text-primary)]">
                    {toCurrencyFormat(group.totalStake / 1e6, 2, 2)}
                  </span>
                  <span className="font-mono text-[14px] text-[var(--text-tertiary)]">
                    $POKT
                  </span>
                </span>
              )}
            </div>

            <div className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--border-primary)]">
              <span className="text-[14px] text-[var(--text-tertiary)]">
                Suppliers
              </span>
              <span className="text-[14px] text-[var(--text-primary)]">
                {group.nodes.length}
              </span>
            </div>

            {index < ownerAddressGroups.length - 1 && (
              <div className="h-[8px] bg-bg-root" />
            )}
          </React.Fragment>
        ))}

        {/* Funds return policy */}
        {uniqueProviders.map((provider) => {
          const approxAmount = toCurrencyFormat(amountToPokt(provider.residualUpokt), 2, 2);
          const returns = provider.returnSupplierFundsToOwner;
          return (
            <div
              key={`funds-${provider.identity}`}
              className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--border-primary)]"
            >
              <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--text-tertiary)]">
                <span>{returns ? 'Returned to Owner' : 'Stays with Operator'}</span>
                <QuickInfoPopOverIcon
                  title={returns ? 'Funds returned to owner' : 'Funds not returned'}
                  description={returns
                    ? "This provider returns the supplier's remaining account balance (minus network fees) to the owner once the unstake is confirmed."
                    : "This provider does not return funds. The supplier's remaining balance (minus the unstake fee) stays with the operator address."}
                  url=""
                />
              </span>
              <span className="flex flex-row gap-2">
                <span className="font-mono text-[14px] text-[var(--text-primary)]">
                  Approx. {approxAmount}
                </span>
                <span className="font-mono text-[14px] text-[var(--text-tertiary)]">
                  $POKT
                </span>
              </span>
            </div>
          );
        })}

        {/* Unstake duration */}
        <div className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--border-primary)]">
          <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--text-tertiary)]">
            <span>Unstake in</span>
            <QuickInfoPopOverIcon
              title="How the unstake duration is calculated"
              description="Estimated from the number of blocks per session, the supplier's unbonding period in sessions, and the average block time measured over the last 30 days of block data. Once confirmed, your tokens are returned to the owner address."
              url=""
            />
          </span>
          {isLoadingDuration ? (
            <Skeleton className="w-[80px] h-5 bg-bg-elevated" />
          ) : (
            <span className={`font-mono text-[14px] ${formattedDuration ? 'text-[var(--text-primary)]' : 'text-yellow-400'}`}>
              {formattedDuration ?? 'N/A'}
            </span>
          )}
        </div>

        {/* Network Fee */}
        <div className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--border-primary)]">
          <span className="flex flex-row items-center gap-2 text-[14px] text-[var(--text-tertiary)]">
            <span>Network Fee</span>
            <QuickInfoPopOverIcon
              title="Network Fee"
              description="The gas cost to broadcast the unstake transaction to the network."
              url=""
            />
          </span>
          {isLoadingNetworkFee ? (
            <Skeleton className="w-[100px] h-5 bg-bg-elevated" />
          ) : isErrorNetworkFee ? (
            <Button onClick={() => refetchNetworkFee()} className="h-[30px]">Retry</Button>
          ) : (
            <span className="flex flex-row gap-2">
              <span className="font-mono text-[14px] text-[var(--text-primary)]">
                {toCurrencyFormat(networkFeeData?.fee ?? 0, 6, 2)}
              </span>
              <span className="font-mono text-[14px] text-[var(--text-tertiary)]">
                $POKT
              </span>
            </span>
          )}
        </div>

        {/* Total */}
        <div className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--border-primary)] bg-[var(--bg-surface)]">
          <span className="text-[14px] font-medium text-[var(--text-tertiary)]">
            Tokens to Receive
          </span>
          {isLoadingNodes ? (
            <Skeleton className="w-[100px] h-5 bg-bg-elevated" />
          ) : (
            <span className="flex flex-row gap-2">
              <span className="font-mono text-[14px] font-medium text-[var(--text-primary)]">
                {toCurrencyFormat(totalStakeAmount / 1e6, 2, 2)}
              </span>
              <span className="font-mono text-[14px] text-[var(--text-tertiary)]">
                $POKT
              </span>
            </span>
          )}
        </div>

        {/* Node Details Expandable */}
        <div className="border-t-2 border-[var(--border-primary)]">
          <div
            className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--border-primary)] hover:cursor-pointer"
            onClick={() => setIsShowingNodeDetails(!isShowingNodeDetails)}
          >
            <span className="flex flex-row items-center gap-2">
              {isShowingNodeDetails ? (
                <CaretSmallIcon className="transform rotate-90" />
              ) : (
                <CaretSmallIcon />
              )}
              <span className="text-[14px] text-[var(--text-tertiary)]">
                Supplier Details ({selectedNodeAddresses.length} supplier{selectedNodeAddresses.length === 1 ? '' : 's'})
              </span>
            </span>
          </div>

          {isShowingNodeDetails && (
            <>
              {isLoadingNodes && (
                <div className="flex flex-col gap-2 p-4">
                  <Skeleton className="w-full h-12 bg-bg-elevated" />
                  <Skeleton className="w-full h-12 bg-bg-elevated" />
                </div>
              )}

              {!isLoadingNodes && ownerAddressGroups.map((group) => (
                <React.Fragment key={`details-${group.ownerAddress}`}>
                  {group.nodes.map((node, nodeIndex) => (
                    <div
                      key={node.address}
                      className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--border-primary)]"
                    >
                      <div className="flex flex-row items-center gap-2">
                        <CornerIcon />
                        <AvatarByString string={node.address} size={18} />
                        <div className="flex flex-col">
                          <Address address={node.address} />
                          <span className="text-[12px] text-[var(--text-tertiary)]">
                            {node.provider?.name || 'Unknown Provider'}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="flex flex-row gap-1">
                          <span className="text-[12px] text-[var(--text-tertiary)]">Stake</span>
                          <span className="font-mono text-[14px] text-[var(--text-primary)]">
                            {toCurrencyFormat(parseFloat(node.stakeAmount) / 1e6, 2, 2)}
                          </span>
                          <span className="font-mono text-[14px] text-[var(--text-tertiary)]">
                            $POKT
                          </span>
                        </span>
                        <span className="flex flex-row gap-1">
                          <span className="text-[12px] text-[var(--text-tertiary)]">Balance</span>
                          <span className="font-mono text-[14px] text-[var(--text-primary)]">
                            {toCurrencyFormat(amountToPokt(node.balance), 2, 2)}
                          </span>
                          <span className="font-mono text-[14px] text-[var(--text-tertiary)]">
                            $POKT
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Gate only on the submit requirement (selected nodes). The nodes/duration
          queries are display-only and must not block unstaking when they fail. */}
      <UnstakingProcess
        disabled={!selectedNodeAddresses?.length}
        selectedNodeAddresses={selectedNodeAddresses}
        ownerAddress={ownerAddress}
        onUnstakeCompleted={onUnstakeCompleted}
      />
    </div>
  );
}
