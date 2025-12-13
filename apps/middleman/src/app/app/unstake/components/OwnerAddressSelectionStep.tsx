'use client';

import { ActivityHeader } from '@igniter/ui/components/ActivityHeader';
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index';
import { useEffect, useState, useMemo } from 'react';
import { getShortAddress, toCurrencyFormat } from '@igniter/ui/lib/utils';
import { Checkbox } from '@igniter/ui/components/checkbox';
import { Button } from '@igniter/ui/components/button';
import { Skeleton } from '@igniter/ui/components/skeleton';
import AvatarByString from '@igniter/ui/components/AvatarByString';
import { useQuery } from '@tanstack/react-query';
import { GetUserNodes } from '@/actions/Nodes';

interface OwnerAddressSelectionStepProps {
  onClose: () => void;
  onBack: () => void;
  selectedOwnerAddress?: string;
  onOwnerAddressSelected: (address: string) => void;
}

interface OwnerAddressData {
  address: string;
  nodeCount: number;
  totalStakedAmount: number;
}

export function OwnerAddressSelectionStep({
  onClose,
  onBack,
  onOwnerAddressSelected,
  selectedOwnerAddress: selectedOwnerAddressFromProps
}: OwnerAddressSelectionStepProps) {
  const { connectedIdentity, connectedIdentities } = useWalletConnection();
  const [selectedOwnerAddress, setSelectedOwnerAddress] = useState(selectedOwnerAddressFromProps || '');

  const {
    data: nodes,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['user-nodes'],
    queryFn: GetUserNodes,
  });

  // Calculate node count and total staked amount per owner address
  const ownerAddressData = useMemo(() => {
    if (!nodes || !connectedIdentities) return [];

    const dataMap = new Map<string, OwnerAddressData>();

    // Initialize all connected identities
    connectedIdentities.forEach(address => {
      dataMap.set(address, {
        address,
        nodeCount: 0,
        totalStakedAmount: 0,
      });
    });

    // Filter only staked nodes and aggregate data
    nodes
      .filter(node => node.status === 'staked' && connectedIdentities.includes(node.ownerAddress))
      .forEach(node => {
        const data = dataMap.get(node.ownerAddress);
        if (data) {
          data.nodeCount += 1;
          data.totalStakedAmount += parseFloat(node.stakeAmount);
        }
      });

    // Convert to array and sort: primary account first, then by node count
    return Array.from(dataMap.values())
      .filter(data => data.nodeCount > 0) // Only show addresses with staked nodes
      .sort((a, b) => {
        if (a.address === connectedIdentity) return -1;
        if (b.address === connectedIdentity) return 1;
        return b.nodeCount - a.nodeCount;
      });
  }, [nodes, connectedIdentities, connectedIdentity]);

  return (
    <div className="flex relative flex-col w-[480px] border-x border-b border-[--black-dividers] bg-[--black-1] p-[33px] rounded-b-[12px] gap-8">
      <ActivityHeader
        title="Select Owner Address"
        subtitle="Choose the owner address of the nodes you want to unstake."
        onBack={onBack}
        onClose={onClose}
      />

      {isLoading && (
        <div className="flex flex-col gap-4">
          <Skeleton className="w-full h-16 bg-gray-700" />
          <Skeleton className="w-full h-16 bg-gray-700" />
          <Skeleton className="w-full h-16 bg-gray-700" />
        </div>
      )}

      {isError && (
        <div className="flex flex-col bg-[#f4424257] p-4 rounded-[8px]">
          <span className="text-[14px] font-medium text-[var(--color-white-1)]">
            Failed to load owner addresses
          </span>
          <Button onClick={() => refetch()} className="mt-2 w-fit">
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {ownerAddressData.length === 0 && (
            <div className="flex flex-col bg-[var(--color-slate-2)] p-4 rounded-[8px]">
              <span className="text-[14px] text-[var(--color-white-3)]">
                No owner addresses with staked nodes found.
              </span>
            </div>
          )}

          {ownerAddressData.length > 0 && (
            <div className="flex flex-col gap-4 h-full overflow-y-auto">
              {ownerAddressData.map((data, index) => {
                const isPrimaryAccount = data.address === connectedIdentity;
                return (
                  <div key={data.address}>
                    <div
                      className={`w-full cursor-pointer select-none flex flex-row items-center gap-2 py-3 pl-3 pr-4 bg-(--input-bg) border rounded-lg ${
                        isPrimaryAccount ? 'border-amber-100' : ''
                      }`}
                      onClick={() => setSelectedOwnerAddress(data.address)}
                    >
                      <AvatarByString string={data.address} />
                      <div className="flex flex-col w-full gap-0">
                        <p className="font-mono text-sm">
                          {getShortAddress(data.address, 5)}
                        </p>
                        <p className="text-[12px] text-[var(--color-white-3)]">
                          {data.nodeCount} {data.nodeCount === 1 ? 'node' : 'nodes'}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-0">
                        <p className="whitespace-nowrap text-xs font-mono text-[var(--color-white-1)]">
                          {toCurrencyFormat(data.totalStakedAmount / 1e6, 2, 2)}
                        </p>
                        <p className="whitespace-nowrap text-[10px] text-[var(--color-white-3)]">
                          $POKT
                        </p>
                      </div>
                      <Checkbox checked={selectedOwnerAddress === data.address} />
                    </div>
                    {isPrimaryAccount && (
                      <p className="!text-[10px] mb-2.5 mt-2 ml-1">
                        You're signed in with this account.
                      </p>
                    )}
                    {isPrimaryAccount && ownerAddressData.length > 1 && (
                      <div className="w-full h-[1px] bg-[var(--slate-dividers)] my-2" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <Button
        disabled={!selectedOwnerAddress || isLoading}
        className="w-full h-[40px]"
        onClick={() => onOwnerAddressSelected(selectedOwnerAddress)}
      >
        Continue
      </Button>
    </div>
  );
}
