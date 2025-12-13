"use client";

import { useCallback, useEffect, useState, useMemo } from 'react';
import { InformationStep } from "@/app/app/unstake/components/InformationStep";
import { OwnerAddressSelectionStep } from "@/app/app/unstake/components/OwnerAddressSelectionStep";
import { NodeSelectionStep } from "@/app/app/unstake/components/NodeSelectionStep";
import { ReviewStep } from "@/app/app/unstake/components/ReviewStep";
import { UnstakeSuccessStep } from "@/app/app/unstake/components/UnstakeSuccessStep";
import { useRouter } from "next/navigation";
import { AbortConfirmationDialog } from '@igniter/ui/components/AbortConfirmationDialog';
import { Transaction } from '@igniter/db/middleman/schema';
import { allStagesSucceeded, getFailedStage } from "@/app/app/unstake/utils";
import { UnstakingProcessStatus } from "@/app/app/unstake/components/ReviewStep/UnstakingProcess";
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index';
import Loading from '@/app/app/unstake/components/Loading';
import OverrideSidebar from '@igniter/ui/components/OverrideSidebar';
import { useQuery } from '@tanstack/react-query';
import { GetUserNodes } from '@/actions/Nodes';

enum UnstakeActivitySteps {
  Information = 'Information',
  OwnerAddressSelection = 'OwnerAddressSelection',
  NodeSelection = 'NodeSelection',
  Review = 'Review',
  Success = 'Success'
}

export default function UnstakePage() {
  const { connectedIdentity, connectedIdentities, isConnected } = useWalletConnection();
  const [step, setStep] = useState<UnstakeActivitySteps>(UnstakeActivitySteps.Information);
  const [selectedOwnerAddress, setSelectedOwnerAddress] = useState<string>('');
  const [selectedNodeAddresses, setSelectedNodeAddresses] = useState<string[]>([]);
  const [transaction, setTransaction] = useState<Transaction | undefined>(undefined);
  const [isAbortDialogOpen, setAbortDialogOpen] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [unstakingErrorMessage, setUnstakingErrorMessage] = useState<string | undefined>(undefined);
  const router = useRouter();

  const {
    data: nodes,
  } = useQuery({
    queryKey: ['user-nodes'],
    queryFn: GetUserNodes,
    enabled: isConnected,
  });

  // Calculate which owner addresses have staked nodes
  const ownerAddressesWithNodes = useMemo(() => {
    if (!nodes || !connectedIdentities) return [];

    const addressesWithNodes = new Set<string>();

    nodes
      .filter(node => node.status === 'staked' && connectedIdentities.includes(node.ownerAddress))
      .forEach(node => {
        addressesWithNodes.add(node.ownerAddress);
      });

    return Array.from(addressesWithNodes);
  }, [nodes, connectedIdentities]);

  // Determine if we should skip owner address selection
  const shouldSkipOwnerSelection = ownerAddressesWithNodes.length === 1;

  // Calculate total stake amount for selected nodes
  const totalStakeAmount = useMemo(() => {
    if (!nodes) return 0;
    const selectedNodes = nodes.filter(node => selectedNodeAddresses.includes(node.address));
    return selectedNodes.reduce((sum, node) => sum + parseFloat(node.stakeAmount), 0);
  }, [nodes, selectedNodeAddresses]);

  const errorsMap: Record<keyof UnstakingProcessStatus, string> = {
    transactionSignatureStatus: 'Transaction signature failed. If you rejected the signature request, please note that your signature is required to complete the unstaking process. Otherwise, check your wallet connection and try again.',
    schedulingTransactionStatus: 'The transaction was signed but could not be scheduled. Please try again or contact support if the issue persists.'
  };

  useEffect(() => {
    if (isConnected) {
      setStep(UnstakeActivitySteps.Information);
    }
  }, [isConnected]);

  const handleInformationNext = () => {
    if (shouldSkipOwnerSelection && ownerAddressesWithNodes.length === 1) {
      // Skip owner selection and go directly to node selection
      setSelectedOwnerAddress(ownerAddressesWithNodes[0]!);
      setStep(UnstakeActivitySteps.NodeSelection);
    } else {
      setStep(UnstakeActivitySteps.OwnerAddressSelection);
    }
  };

  const handleOwnerAddressSelected = (address: string) => {
    setSelectedOwnerAddress(address);
    setStep(UnstakeActivitySteps.NodeSelection);
  };

  const handleNodesSelected = (nodeAddresses: string[]) => {
    setSelectedNodeAddresses(nodeAddresses);
    setStep(UnstakeActivitySteps.Review);
  };

  const onAbort = useCallback(async (abort: boolean) => {
    if (abort) {
      setIsAborting(true);
      try {
        setIsAborting(false);
        await router.push('/app');
      } catch (error) {
        console.error(error);
        setIsAborting(false);
      } finally {
        setAbortDialogOpen(false);
      }
    } else {
      setAbortDialogOpen(false);
    }
  }, [router]);

  if (!isConnected) {
    return (
      <div className="flex flex-row justify-center w-full">
        <Loading />
      </div>
    );
  }

  return (
    <>
      <OverrideSidebar>
        <div className="flex flex-row justify-center overflow-auto pb-16">
          {step === UnstakeActivitySteps.Information && (
            <InformationStep
              onNext={handleInformationNext}
              onClose={() => setAbortDialogOpen(true)}
            />
          )}

          {step === UnstakeActivitySteps.OwnerAddressSelection && (
            <OwnerAddressSelectionStep
              selectedOwnerAddress={selectedOwnerAddress}
              onOwnerAddressSelected={handleOwnerAddressSelected}
              onBack={() => setStep(UnstakeActivitySteps.Information)}
              onClose={() => setAbortDialogOpen(true)}
            />
          )}

          {step === UnstakeActivitySteps.NodeSelection && (
            <NodeSelectionStep
              ownerAddress={selectedOwnerAddress}
              selectedNodes={selectedNodeAddresses}
              onNodesSelected={handleNodesSelected}
              onBack={() => {
                if (shouldSkipOwnerSelection) {
                  setStep(UnstakeActivitySteps.Information);
                } else {
                  setStep(UnstakeActivitySteps.OwnerAddressSelection);
                }
              }}
              onClose={() => setAbortDialogOpen(true)}
            />
          )}

          {step === UnstakeActivitySteps.Review && (
            <ReviewStep
              selectedNodeAddresses={selectedNodeAddresses}
              ownerAddress={connectedIdentity!}
              errorMessage={unstakingErrorMessage}
              onUnstakeCompleted={(result, transaction) => {
                if (allStagesSucceeded(result)) {
                  setStep(UnstakeActivitySteps.Success);
                  setTransaction(transaction);
                } else {
                  const failedStage = getFailedStage(result);
                  if (failedStage) {
                    setUnstakingErrorMessage(errorsMap[failedStage]);
                  }
                }
              }}
              onBack={() => {
                setStep(UnstakeActivitySteps.NodeSelection);
              }}
              onClose={() => setAbortDialogOpen(true)}
            />
          )}

          {step === UnstakeActivitySteps.Success && transaction && (
            <UnstakeSuccessStep
              nodeCount={selectedNodeAddresses.length}
              totalStakeAmount={totalStakeAmount}
              transaction={transaction}
              onClose={() => {
                router.push('/app');
              }}
            />
          )}
        </div>
      </OverrideSidebar>
      <AbortConfirmationDialog
        isOpen={isAbortDialogOpen}
        isLoading={isAborting}
        onResponse={(abort) => { onAbort(abort) }}
      />
    </>
  );
}
