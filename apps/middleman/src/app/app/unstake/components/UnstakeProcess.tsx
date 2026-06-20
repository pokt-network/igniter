"use client";

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@igniter/ui/components/dialog';
import { Button } from '@igniter/ui/components/button';
import { ActivityHeader } from '@igniter/ui/components/ActivityHeader';
import { Transaction } from '@igniter/db/middleman/schema';
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index';
import { OwnerAddressSelectionStep } from "@/app/app/unstake/components/OwnerAddressSelectionStep";
import { NodeSelectionStep } from "@/app/app/unstake/components/NodeSelectionStep";
import { ReviewStep } from "@/app/app/unstake/components/ReviewStep";
import { UnstakeSuccessStep } from "@/app/app/unstake/components/UnstakeSuccessStep";
import Loading from '@/app/app/unstake/components/Loading';
import { allStagesSucceeded, getFailedStage } from "@/app/app/unstake/utils";
import { UnstakingProcessStatus } from "@/app/app/unstake/components/ReviewStep/UnstakingProcess";
import { GetUserNodes } from '@/actions/Nodes';
import { usePendingGuards } from '@/lib/pending/usePendingGuards';

enum UnstakeActivitySteps {
  // Initial sentinel: the flow shows a loader while the user-nodes query resolves, then
  // routes to the first real step (no standalone information screen — its timeline content
  // now lives on the Review step behind a details popover).
  Routing = 'Routing',
  OwnerAddressSelection = 'OwnerAddressSelection',
  NodeSelection = 'NodeSelection',
  Review = 'Review',
  Success = 'Success'
}

export interface UnstakeProcessProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * When provided, the flow is pre-scoped to these supplier addresses and routes straight
   * to Review — skipping owner + supplier selection. Used when the unstake is started from
   * a single supplier's detail. Omit for the bulk flow (full selection).
   */
  preselectedAddresses?: string[];
}

export function UnstakeProcess({ open, onOpenChange, preselectedAddresses }: Readonly<UnstakeProcessProps>) {
  const { connectedIdentities, isConnected } = useWalletConnection();
  const { isOperatorPending, isOwnerBusy } = usePendingGuards();
  const router = useRouter();

  const [step, setStep] = useState<UnstakeActivitySteps>(UnstakeActivitySteps.Routing);
  const [selectedOwnerAddress, setSelectedOwnerAddress] = useState<string>('');
  const [selectedNodeAddresses, setSelectedNodeAddresses] = useState<string[]>([]);
  const [transaction, setTransaction] = useState<Transaction | undefined>(undefined);
  const [unstakingErrorMessage, setUnstakingErrorMessage] = useState<string | undefined>(undefined);
  // Preselected path: the suppliers couldn't be resolved (fetch error, or none of the
  // preselected addresses is still staked).
  const [preselectError, setPreselectError] = useState(false);

  const isPreselected = !!(preselectedAddresses && preselectedAddresses.length > 0);

  const {
    data: nodes,
    isLoading: isLoadingNodes,
    isError: isErrorNodes,
    refetch: refetchNodes,
  } = useQuery({
    queryKey: ['user-nodes'],
    queryFn: GetUserNodes,
    enabled: isConnected && open,
  });

  // Owner addresses that still have staked nodes (for the bulk selection path).
  // Exclude owners that have a pending tx — their signer is busy.
  const ownerAddressesWithNodes = useMemo(() => {
    if (!nodes || !connectedIdentities) return [];
    const set = new Set<string>();
    nodes
      .filter(node =>
        node.status === 'staked' &&
        connectedIdentities.includes(node.ownerAddress) &&
        !isOwnerBusy(node.ownerAddress)
      )
      .forEach(node => set.add(node.ownerAddress));
    return Array.from(set);
  }, [nodes, connectedIdentities, isOwnerBusy]);

  const shouldSkipOwnerSelection = ownerAddressesWithNodes.length === 1;

  // Staked preselected suppliers. Status-filtered so a stale already-unstaking/unstaked
  // supplier never reaches Review (where it would produce a chain-rejected tx).
  // Also exclude operators with a pending tx to prevent double-firing.
  const preselectedStakedAddresses = useMemo(() => {
    if (!isPreselected || !nodes) return [];
    return preselectedAddresses!.filter(addr =>
      nodes.some(node => node.address === addr && node.status === 'staked') &&
      !isOperatorPending(addr)
    );
  }, [isPreselected, nodes, preselectedAddresses, isOperatorPending]);

  const totalStakeAmount = useMemo(() => {
    if (!nodes) return 0;
    return nodes
      .filter(node => selectedNodeAddresses.includes(node.address))
      .reduce((sum, node) => sum + parseFloat(node.stakeAmount), 0);
  }, [nodes, selectedNodeAddresses]);

  const errorsMap: Record<keyof UnstakingProcessStatus, string> = {
    transactionSignatureStatus: 'Transaction signature failed. If you rejected the signature request, please note that your signature is required to complete the unstaking process. Otherwise, check your wallet connection and try again.',
    schedulingTransactionStatus: 'The transaction was signed but could not be scheduled. Please try again or contact support if the issue persists.'
  };

  // Reset to the routing sentinel each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setUnstakingErrorMessage(undefined);
    setTransaction(undefined);
    setStep(UnstakeActivitySteps.Routing);
    setPreselectError(false);
    setSelectedOwnerAddress('');
    setSelectedNodeAddresses([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Route from the sentinel to the first real step once the user-nodes query resolves.
  useEffect(() => {
    if (!open || step !== UnstakeActivitySteps.Routing || preselectError) return;
    if (isLoadingNodes) return;
    if (isPreselected) {
      if (isErrorNodes || !nodes || preselectedStakedAddresses.length === 0) {
        setPreselectError(true);
        return;
      }
      const owner = nodes.find(node => node.address === preselectedStakedAddresses[0])?.ownerAddress ?? '';
      setSelectedOwnerAddress(owner);
      setSelectedNodeAddresses(preselectedStakedAddresses);
      setStep(UnstakeActivitySteps.Review);
    } else if (shouldSkipOwnerSelection) {
      setSelectedOwnerAddress(ownerAddressesWithNodes[0]!);
      setStep(UnstakeActivitySteps.NodeSelection);
    } else {
      setStep(UnstakeActivitySteps.OwnerAddressSelection);
    }
  }, [open, step, preselectError, isLoadingNodes, isErrorNodes, nodes, isPreselected, preselectedStakedAddresses, shouldSkipOwnerSelection, ownerAddressesWithNodes]);

  const close = () => onOpenChange(false);

  const handleOwnerAddressSelected = (address: string) => {
    setSelectedOwnerAddress(address);
    setStep(UnstakeActivitySteps.NodeSelection);
  };

  const handleNodesSelected = (nodeAddresses: string[]) => {
    setSelectedNodeAddresses(nodeAddresses);
    setStep(UnstakeActivitySteps.Review);
  };

  const retryPreselect = () => {
    setPreselectError(false);
    refetchNodes();
    setStep(UnstakeActivitySteps.Routing);
  };

  const showLoader = open && (!isConnected || (step === UnstakeActivitySteps.Routing && !preselectError));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        onInteractOutside={(event) => event.preventDefault()}
        className="p-0 border-none bg-transparent shadow-none w-auto max-w-none sm:max-w-none max-h-[90vh] overflow-y-auto"
      >
        <DialogTitle className="sr-only">Unstake suppliers</DialogTitle>

        {showLoader && (
          <div className="flex flex-row justify-center w-[480px]">
            <Loading />
          </div>
        )}

        {!showLoader && preselectError && (
          <div className="flex flex-col w-[480px] border-x border-b border-border-primary bg-bg-root p-[33px] rounded-b-[12px] gap-6">
            <ActivityHeader
              onClose={close}
              title="Unstake Suppliers"
              subtitle="Review the details of your unstake operation."
            />
            <div className="flex flex-col bg-error-bg p-4 rounded-[8px] gap-3">
              <span className="text-[14px] text-[var(--text-primary)]">
                {isErrorNodes
                  ? 'Failed to load this supplier. Please try again.'
                  : 'This supplier is no longer available to unstake.'}
              </span>
              <div className="flex gap-2">
                {isErrorNodes && (
                  <Button onClick={retryPreselect} className="w-fit h-[30px]">
                    Retry
                  </Button>
                )}
                <Button variant="secondaryBorder" onClick={close} className="w-fit h-[30px]">
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}

        {!showLoader && step === UnstakeActivitySteps.OwnerAddressSelection && (
          <OwnerAddressSelectionStep
            nodes={nodes}
            isLoading={isLoadingNodes}
            isError={isErrorNodes}
            onRetry={refetchNodes}
            selectedOwnerAddress={selectedOwnerAddress}
            onOwnerAddressSelected={handleOwnerAddressSelected}
            onBack={close}
            onClose={close}
          />
        )}

        {!showLoader && step === UnstakeActivitySteps.NodeSelection && (
          <NodeSelectionStep
            nodes={nodes}
            isLoading={isLoadingNodes}
            isError={isErrorNodes}
            onRetry={refetchNodes}
            ownerAddress={selectedOwnerAddress}
            selectedNodes={selectedNodeAddresses}
            onNodesSelected={handleNodesSelected}
            onBack={() => {
              if (shouldSkipOwnerSelection) {
                close();
              } else {
                setStep(UnstakeActivitySteps.OwnerAddressSelection);
              }
            }}
            onClose={close}
          />
        )}

        {!showLoader && step === UnstakeActivitySteps.Review && (
          <ReviewStep
            nodes={nodes}
            isLoadingNodes={isLoadingNodes}
            isErrorNodes={isErrorNodes}
            onRetryNodes={refetchNodes}
            selectedNodeAddresses={selectedNodeAddresses}
            ownerAddress={selectedOwnerAddress}
            errorMessage={unstakingErrorMessage}
            onUnstakeCompleted={(result, tx) => {
              if (allStagesSucceeded(result)) {
                setStep(UnstakeActivitySteps.Success);
                setTransaction(tx);
              } else {
                const failedStage = getFailedStage(result);
                if (failedStage) {
                  setUnstakingErrorMessage(errorsMap[failedStage]);
                }
              }
            }}
            // Preselected single-supplier flow: Review is the first screen, so Back closes.
            // Bulk flow returns to supplier selection.
            onBack={() => {
              if (isPreselected) {
                close();
              } else {
                setStep(UnstakeActivitySteps.NodeSelection);
              }
            }}
            onClose={close}
          />
        )}

        {!showLoader && step === UnstakeActivitySteps.Success && transaction && (
          <UnstakeSuccessStep
            nodeCount={selectedNodeAddresses.length}
            totalStakeAmount={totalStakeAmount}
            transaction={transaction}
            onClose={() => {
              onOpenChange(false);
              router.refresh();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
