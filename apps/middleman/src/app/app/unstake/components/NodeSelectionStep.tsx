'use client';

import { ActivityHeader } from "@igniter/ui/components/ActivityHeader";
import { Button } from "@igniter/ui/components/button";
import { Skeleton } from "@igniter/ui/components/skeleton";
import { Input } from "@igniter/ui/components/input";
import { Checkbox } from "@igniter/ui/components/checkbox";
import { useQuery } from "@tanstack/react-query";
import { GetUserNodes } from "@/actions/Nodes";
import { useState, useMemo } from "react";
import { NodeWithDetails } from "@igniter/db/middleman/schema";
import { getShortAddress, toCurrencyFormat } from "@igniter/ui/lib/utils";
import AvatarByString from "@igniter/ui/components/AvatarByString";

export interface NodeSelectionStepProps {
  ownerAddress: string;
  selectedNodes: string[];
  onNodesSelected: (nodeAddresses: string[]) => void;
  onBack: () => void;
  onClose: () => void;
}

export function NodeSelectionStep({
  ownerAddress,
  selectedNodes,
  onNodesSelected,
  onBack,
  onClose,
}: Readonly<NodeSelectionStepProps>) {
  const [searchTerm, setSearchTerm] = useState("");
  const [internalSelectedNodes, setInternalSelectedNodes] = useState<string[]>(selectedNodes);

  const {
    data: nodes,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['user-nodes'],
    queryFn: GetUserNodes,
  });

  // Filter nodes based on owner address and search term
  const filteredNodes = useMemo(() => {
    if (!nodes) return [];

    // Only show staked nodes from the selected owner address
    const ownerNodes = nodes.filter(
      node => node.status === 'staked' && node.ownerAddress === ownerAddress
    );

    if (!searchTerm.trim()) return ownerNodes;

    const lowerSearch = searchTerm.toLowerCase();
    return ownerNodes.filter(node => {
      // Search by operator address (node address)
      if (node.address.toLowerCase().includes(lowerSearch)) return true;

      // Search by provider name
      if (node.provider?.name?.toLowerCase().includes(lowerSearch)) return true;

      return false;
    });
  }, [nodes, ownerAddress, searchTerm]);

  const handleToggleNode = (node: NodeWithDetails) => {
    setInternalSelectedNodes(prev =>
      prev.includes(node.address)
        ? prev.filter(addr => addr !== node.address)
        : [...prev, node.address]
    );
  };

  const handleToggleAll = () => {
    const filteredAddresses = filteredNodes.map(n => n.address);

    const allSelected = filteredAddresses.every(addr =>
      internalSelectedNodes.includes(addr)
    );

    if (allSelected) {
      // Unselect all filtered nodes
      setInternalSelectedNodes(prev =>
        prev.filter(addr => !filteredAddresses.includes(addr))
      );
    } else {
      // Select all filtered nodes
      setInternalSelectedNodes(prev => {
        const newSelected = [...prev];
        filteredAddresses.forEach(addr => {
          if (!newSelected.includes(addr)) {
            newSelected.push(addr);
          }
        });
        return newSelected;
      });
    }
  };

  const allFilteredSelected = useMemo(() => {
    if (filteredNodes.length === 0) return false;
    return filteredNodes.every(node => internalSelectedNodes.includes(node.address));
  }, [filteredNodes, internalSelectedNodes]);

  const handleContinue = () => {
    onNodesSelected(internalSelectedNodes);
  };

  return (
    <div className="flex flex-col w-[480px] border-x border-b border-[--black-dividers] bg-[--black-1] p-[33px] rounded-b-[12px] gap-6">
      <ActivityHeader
        onBack={onBack}
        onClose={onClose}
        title="Select Nodes"
        subtitle="Choose the nodes you want to unstake."
      />

      <Input
        type="text"
        placeholder="Search by address, provider..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="w-full"
      />

      {isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="w-full h-16 bg-gray-700" />
          <Skeleton className="w-full h-16 bg-gray-700" />
          <Skeleton className="w-full h-16 bg-gray-700" />
        </div>
      )}

      {isError && (
        <div className="flex flex-col bg-[#f4424257] p-4 rounded-[8px]">
          <span className="text-[14px] font-medium text-[var(--color-white-1)]">
            Failed to load nodes
          </span>
          <Button onClick={() => refetch()} className="mt-2 w-fit">
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && nodes && (
        <>
          {filteredNodes.length === 0 && (
            <div className="flex flex-col bg-[var(--color-slate-2)] p-4 rounded-[8px]">
              <span className="text-[14px] text-[var(--color-white-3)]">
                {searchTerm ? "No nodes found matching your search." : "You don't have any staked nodes to unstake."}
              </span>
            </div>
          )}

          {filteredNodes.length > 0 && (
            <>
              <div className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)] bg-[var(--color-slate-2)] rounded-t-[8px]">
                <div className="flex flex-row items-center gap-3">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={handleToggleAll}
                    disabled={filteredNodes.length === 0}
                  />
                  <span className="text-[14px] text-[var(--color-white-3)]">
                    Select All ({filteredNodes.length} available)
                  </span>
                </div>
                <span className="text-[14px] text-[var(--color-white-1)]">
                  {internalSelectedNodes.length} selected
                </span>
              </div>

              <div className="flex flex-col max-h-[400px] overflow-y-auto border border-[var(--black-dividers)] rounded-b-[8px]">
                {filteredNodes.map((node) => {
                  return (
                    <div
                      key={node.address}
                      className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)] last:border-b-0 hover:bg-[var(--color-slate-2)] cursor-pointer"
                      onClick={() => handleToggleNode(node)}
                    >
                      <div className="flex flex-row items-center gap-3 flex-1">
                        <Checkbox
                          checked={internalSelectedNodes.includes(node.address)}
                          onCheckedChange={() => handleToggleNode(node)}
                        />
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-row items-center gap-2">
                            <AvatarByString string={node.address} />
                            <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                              {getShortAddress(node.address, 5)}
                            </span>
                          </div>
                          {node.provider?.name && (
                            <div className="flex flex-row items-center gap-2 text-[12px] text-[var(--color-white-3)]">
                              <span>Provider: {node.provider.name}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0">
                        <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                          {toCurrencyFormat(parseFloat(node.stakeAmount) / 1e6, 2, 2)}
                        </span>
                        <span className="font-mono text-[12px] text-[var(--color-white-3)]">
                          $POKT
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      <Button
        onClick={handleContinue}
        disabled={internalSelectedNodes.length === 0}
        className="w-full"
      >
        Continue ({internalSelectedNodes.length} nodes)
      </Button>
    </div>
  );
}
