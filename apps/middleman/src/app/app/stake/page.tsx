"use client";

import {useCallback, useEffect, useState} from 'react'
import {PickStakeAmountStep} from "@/app/app/stake/components/PickStakeAmountStep";
import {PickOfferStep} from "@/app/app/stake/components/PickOfferStep";
import {ReviewStep} from "@/app/app/stake/components/ReviewStep";
import {StakeDistributionOffer} from "@/lib/models/StakeDistributionOffer";
import {StakeSuccessStep} from "@/app/app/stake/components/StakeSuccessStep";
import {useRouter} from "next/navigation";
import {AbortConfirmationDialog} from '@igniter/ui/components/AbortConfirmationDialog'
import { Transaction } from '@igniter/db/middleman/schema'
import {allStagesSucceeded, getFailedStage} from "@/app/app/stake/utils";
import {StakingProcessStatus} from "@/app/app/stake/components/ReviewStep/StakingProcess";
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index'
import OwnerAddressStep from '@/app/app/stake/components/OwnerAddressStep'
import Loading from '@/app/app/stake/components/Loading'
import {SupplierStake} from "@/lib/models/Transactions";
import {releaseSuppliers} from "@/lib/services/provider";
import {useNotifications} from "@igniter/ui/context/Notifications/index";
import OverrideSidebar from '@igniter/ui/components/OverrideSidebar'


enum StakeActivitySteps {
    OwnerAddress = 'OwnerAddress',
    PickStakeAmount = 'PickStakeAmount',
    PickOffer = 'PickOffer',
    Review = 'Review',
    Success = 'Success'
}

export default function StakePage() {
  const {connectedIdentity, connectedIdentities, isConnected} = useWalletConnection()
    const [step, setStep] = useState<StakeActivitySteps>(
      connectedIdentities && connectedIdentities.length > 1 ?
        StakeActivitySteps.OwnerAddress :
        StakeActivitySteps.PickStakeAmount
    );

    const [stakeAmount, setStakeAmount] = useState<number>(0);
    const [selectedOffer, setSelectedOffer] = useState<StakeDistributionOffer | undefined>();
    const [transaction, setTransaction] = useState<Transaction | undefined>(undefined);
    const [isAbortDialogOpen, setAbortDialogOpen] = useState(false);
    const [isAborting, setIsAborting] = useState(false);
    const [ownerAddress, setOwnerAddress] = useState<string>(
      connectedIdentities!.length > 1 ?
      '' : connectedIdentity!
    );
    const [stakingErrorMessage, setStakingErrorMessage] = useState<string | undefined>(undefined);
    const [supplierProspects, setSupplierProspects] = useState<Array<SupplierStake>>([]);
    const { addNotification } = useNotifications();
    const router = useRouter();

    const errorsMap: Record<keyof StakingProcessStatus, string> = {
      requestSuppliersStatus: 'The staking process failed while requesting suppliers. Please try again later or contact support if the issue persists.',
      transactionSignatureStatus: 'Transaction signature failed. If you rejected the signature request, please note that your signature is required to complete the staking process. Otherwise, check your wallet connection and try again.',
      schedulingTransactionStatus: 'The transaction was signed but could not be scheduled. Please try again or contact support if the issue persists.'
    };

    useEffect(() => {
        if (isConnected) {
          setOwnerAddress(
            connectedIdentities!.length > 1 ?
              '' : connectedIdentity!
          )
          setStep(
            connectedIdentities!.length > 1 ?
              StakeActivitySteps.OwnerAddress :
              StakeActivitySteps.PickStakeAmount
          );
        }
    }, [isConnected])

    const handleOwnerAddressChange = (address: string) => {
      setOwnerAddress(address);
      setStep(StakeActivitySteps.PickStakeAmount);
    }

    const handleStakeAmountChange = (amount: number) => {
        setStakeAmount(amount);
        setStep(StakeActivitySteps.PickOffer);
    };

    const onAbort = useCallback(async (abort: boolean) => {
        if (abort) {
            setIsAborting(true);
            try {
                if (supplierProspects.length > 0) {
                    const addresses = supplierProspects.map((s) => s.operatorAddress);
                    await releaseSuppliers(selectedOffer!, addresses);
                }
                setIsAborting(false);
                await router.push('/app');
            } catch (error) {
                console.error(error);
                addNotification({
                    id: `abort-stake-error`,
                    type: 'error',
                    showTypeIcon: true,
                    content: 'An error occurred while aborting the staking process. Please try again or contact support if the issue persists.',
                });
                setIsAborting(false);
            } finally {
                setAbortDialogOpen(false);
            }
        } else {
            setAbortDialogOpen(false);
        }
    }, [supplierProspects]);

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
                {step === StakeActivitySteps.OwnerAddress && (
                  <OwnerAddressStep
                    onClose={() => setAbortDialogOpen(true)}
                    onOwnerAddressSelected={handleOwnerAddressChange}
                    selectedOwnerAddress={ownerAddress}
                  />
                )}

                {step === StakeActivitySteps.PickStakeAmount && (
                    <PickStakeAmountStep
                        ownerAddress={ownerAddress}
                        defaultAmount={stakeAmount}
                        onAmountSelected={handleStakeAmountChange}
                        onClose={() => setAbortDialogOpen(true)}
                        onBack={
                          connectedIdentities!.length > 1 ?
                            () => setStep(StakeActivitySteps.OwnerAddress) :
                            undefined
                        }
                    />
                )}

                {step === StakeActivitySteps.PickOffer && (
                    <PickOfferStep
                        amount={stakeAmount}
                        ownerAddress={ownerAddress}
                        defaultOffer={selectedOffer}
                        onOfferSelected={(offer) => {
                            setSelectedOffer(offer);
                            setStep(StakeActivitySteps.Review);
                        }}
                        onBack={() => {
                            setStep(StakeActivitySteps.PickStakeAmount);
                        }}
                        onClose={() => setAbortDialogOpen(true)}
                    />
                )}

                {step === StakeActivitySteps.Review && (
                    <ReviewStep
                        amount={stakeAmount}
                        errorMessage={stakingErrorMessage}
                        selectedOffer={selectedOffer!}
                        ownerAddress={ownerAddress}
                        onSuppliersReceived={setSupplierProspects}
                        onStakeCompleted={(result, transaction) => {
                            if (allStagesSucceeded(result)) {
                                setStep(StakeActivitySteps.Success);
                                setTransaction(transaction)
                            } else {
                              const failedStage = getFailedStage(result);
                              if (failedStage) {
                                setStakingErrorMessage(errorsMap[failedStage]);
                              }
                            }
                        }}
                        onBack={() => {
                            setStep(StakeActivitySteps.PickOffer);
                        }}
                        onClose={() => setAbortDialogOpen(true)}
                    />
                )}

                {step === StakeActivitySteps.Success && (
                    <StakeSuccessStep
                        transaction={transaction!}
                        amount={stakeAmount}
                        selectedOffer={selectedOffer!}
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
