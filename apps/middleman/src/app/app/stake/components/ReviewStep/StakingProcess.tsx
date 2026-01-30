"use client";

import {Button} from "@igniter/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@igniter/ui/components/dialog";
import {useEffect, useState} from "react";
import {CheckSuccess, LoaderIcon, XIcon} from "@igniter/ui/assets";
import {StakeDistributionOffer} from "@/lib/models/StakeDistributionOffer";
import {Transaction as DbTransaction} from "@igniter/db/middleman/schema";
import {requestSuppliers} from "@/lib/services/provider";
import {SignedTransaction, SupplierStake, TransactionMessage,} from "@/lib/models/Transactions";
import {useApplicationSettings} from "@/app/context/ApplicationSettings";
import {useWalletConnection} from "@igniter/ui/context/WalletConnection/index";
import {CreateSignedMemo, CreateStakeTransaction} from "@/actions/Stake";
import {StageStatus} from "@/app/app/stake/types";
import {stageFailed, stageSucceeded} from "@/app/app/stake/utils";
import {useNotifications} from "@igniter/ui/context/Notifications/index";

export interface StakingProcessStatus {
  requestSuppliersStatus: StageStatus;
  transactionSignatureStatus: StageStatus;
  schedulingTransactionStatus: StageStatus;
}

export interface StakingProcessProps {
  offer: StakeDistributionOffer;
  ownerAddress: string;
  region?: string;
  onStakeCompleted: (result: StakingProcessStatus, transaction?: DbTransaction) => void;
  onSuppliersReceived: (suppliers: SupplierStake[]) => void;
  disabled?: boolean
  selectedAddressGroupId: number
}

enum StakingProcessStep {
  requestSuppliers,
  transactionSignature,
  SchedulingTransaction,
  Completed
}

export function StakingProcess({offer, onStakeCompleted, ownerAddress, region, onSuppliersReceived, disabled, selectedAddressGroupId}: Readonly<StakingProcessProps>) {
  const [open, setOpen] = useState(false);
  const [isCancellable, setIsCancellable] = useState<boolean>(true);
  const [stakingStatus, setStakingStatus] = useState<StakingProcessStatus>({
    requestSuppliersStatus: 'pending',
    transactionSignatureStatus: 'pending',
    schedulingTransactionStatus: 'pending',
  });
  const [currentStep, setCurrentStep] = useState<StakingProcessStep>(StakingProcessStep.requestSuppliers);
  const settings = useApplicationSettings();
  const {signTransaction} = useWalletConnection();
  const [transaction, setTransaction] = useState<DbTransaction | null>(null);
  const [transactionMessages, setTransactionMessages] = useState<TransactionMessage[]>([]);
  const [signedTransaction, setSignedTransaction] = useState<SignedTransaction | null>(null);
  const { addNotification } = useNotifications();

  useEffect(() => {
    (async () => {
      if (!open || currentStep !== StakingProcessStep.requestSuppliers) {
        return;
      }
      try {
        const suppliers = await requestSuppliers(selectedAddressGroupId, offer, settings!, ownerAddress, region);

        const stakeTransactions: TransactionMessage[] = suppliers.map((supplier) => {
          return {
            typeUrl: '/pocket.supplier.MsgStakeSupplier',
            body: {
              ...supplier,
              // owner can't no longer change the services, not even in the first stake
              services: [],
              stakeAmount: (Number(supplier.stakeAmount) * 1e6).toString(),
              ownerAddress: ownerAddress,
              signer: ownerAddress,
            },
          };
        });

        const ofTransactions: TransactionMessage[] = suppliers.map(supplier => {
          return {
            typeUrl: '/cosmos.bank.v1beta1.MsgSend',
            body: {
              fromAddress: ownerAddress,
              toAddress: supplier.operatorAddress,
              amount: (offer.operationalFundsAmount * 1e6).toString(),
            },
          };
        });

        setTransactionMessages([...stakeTransactions, ...ofTransactions]);

        setStakingStatus((prev) => ({
          ...prev,
          requestSuppliersStatus: 'success',
        }));

        onSuppliersReceived(suppliers);

        setCurrentStep(StakingProcessStep.transactionSignature);
      } catch (err) {
        const { message } = err as Error;
        console.log('An error occurred while retrieving the supplier stake info. Error:', message);
        handleFailedStage('requestSuppliersStatus', 'An error occurred while retrieving the supplier stake info. You have incurred no fees. You can try again. If the problem persists, please contact support.');
      }
    })();
  }, [open, currentStep]);

  useEffect(() => {
    (async () => {
      if (!open || currentStep !== StakingProcessStep.transactionSignature) {
        return;
      }

      try {
        const signedMemo = await CreateSignedMemo({ settings: settings! });
        const signedTx = await signTransaction(transactionMessages, ownerAddress, signedMemo);

        setSignedTransaction(signedTx);

        setStakingStatus((prev) => ({
          ...prev,
          transactionSignatureStatus: 'success',
        }));

        setIsCancellable(false);

        setCurrentStep(StakingProcessStep.SchedulingTransaction);
      } catch (err) {
        const { message } = err as Error;
        console.log('An error occurred while collecting the signature.Error:', message);
        handleFailedStage('transactionSignatureStatus', 'An unknown error occurred while collecting your signature for the transaction. If it was intentionally rejected, this is required in order to proceed. If not, please make sure you have a supported wallet extension enabled. You have incurred no fees. You can try again. If the problem persists, please contact support.');
      }
    })();
  }, [open, currentStep]);

  useEffect(() => {
    (async () => {
      if (!open || currentStep !== StakingProcessStep.SchedulingTransaction) {
        return;
      }

      try {
        const createdTransaction = await CreateStakeTransaction({
          offer,
          transaction: signedTransaction!,
        });

        setTransaction(createdTransaction);

        setStakingStatus((prev) => ({
          ...prev,
          schedulingTransactionStatus: 'success',
        }));

        setCurrentStep(StakingProcessStep.Completed);
      } catch (err) {
        const { message } = err as Error;
        console.log('An error occurred while scheduling the signed transactions. Error:', message);
        handleFailedStage('schedulingTransactionStatus', 'An unknown error occurred while scheduling the signed transactions.');
      }
    })();
  }, [open, currentStep]);

  useEffect(() => {
    if (open && currentStep === StakingProcessStep.Completed) {
      setTimeout(() => {
        onStakeCompleted({
          ...stakingStatus,
        }, transaction!);
        setOpen(false);
      }, 1000);
    }
  }, [open, currentStep]);

  function handleOpenChanged(open: boolean) {
    setOpen(open);

    if (!open) {
      let newStep: StakingProcessStep

      if (stakingStatus.requestSuppliersStatus !== 'success') {
        newStep = StakingProcessStep.requestSuppliers;
      } else if (stakingStatus.transactionSignatureStatus !== 'success') {
        newStep = StakingProcessStep.transactionSignature;
      } else if (stakingStatus.schedulingTransactionStatus !== 'success') {
        newStep = StakingProcessStep.SchedulingTransaction;
      } else {
        newStep = StakingProcessStep.Completed;
      }

      setCurrentStep(newStep);

      let newStakingStatus: StakingProcessStatus

      if (newStep === StakingProcessStep.requestSuppliers) {
        newStakingStatus = {
          requestSuppliersStatus: 'pending',
          transactionSignatureStatus: 'pending',
          schedulingTransactionStatus: 'pending',
        }
      } else if (newStep === StakingProcessStep.transactionSignature) {
        newStakingStatus = {
          requestSuppliersStatus: 'success',
          transactionSignatureStatus: 'pending',
          schedulingTransactionStatus: 'pending',
        }
      } else if (newStep === StakingProcessStep.SchedulingTransaction) {
        newStakingStatus = {
          requestSuppliersStatus: 'success',
          transactionSignatureStatus: 'success',
          schedulingTransactionStatus: 'pending',
        }
      } else {
        // return if every step was completed
        return
      }

      setStakingStatus(newStakingStatus);
      setIsCancellable(false);
    } else {
      if (currentStep === StakingProcessStep.Completed) {
        return
      } else if (currentStep === StakingProcessStep.requestSuppliers) {
        setStakingStatus({
          requestSuppliersStatus: 'pending',
          transactionSignatureStatus: 'pending',
          schedulingTransactionStatus: 'pending',
        })
      } else if (currentStep === StakingProcessStep.transactionSignature) {
        setStakingStatus({
          requestSuppliersStatus: 'success',
          transactionSignatureStatus: 'pending',
          schedulingTransactionStatus: 'pending',
        })
      } else if (currentStep === StakingProcessStep.SchedulingTransaction) {
        setStakingStatus({
          requestSuppliersStatus: 'success',
          transactionSignatureStatus: 'success',
          schedulingTransactionStatus: 'pending',
        })
      }

      setIsCancellable(true);
    }
  }

  function handleFailedStage(stageName: keyof StakingProcessStatus, message?: string) {
    setStakingStatus((prev) => ({
      ...prev,
      [stageName]: 'error',
    }));

    setTimeout(() => {
      setStakingStatus(currentStatus => {
        onStakeCompleted(currentStatus);
        handleOpenChanged(false);
        return currentStatus;
      });

      if (message) {
        addNotification({
          id: `stake-process-${stageName}-error`,
          type: 'error',
          showTypeIcon: true,
          content: message,
        });
      }
    }, 1000);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChanged}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>Stake</Button>
      </DialogTrigger>
      <DialogContent
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        className="gap-0 w-[280px] p-0 rounded-lg bg-[var(--color-slate-2)]"
        hideClose
      >
        <DialogTitle asChild>
          <div className="flex flex-row justify-between items-center py-3 px-4">
            <span className="text-[14px]">Processing</span>
            <LoaderIcon className="animate-spin"/>
          </div>
        </DialogTitle>
        <div className="h-[1px] bg-[var(--slate-dividers)]"></div>
        <div className="flex flex-row justify-between items-center py-3 px-4">
          <span className="text-[14px]">Requesting Keys</span>
          {stageSucceeded(stakingStatus.requestSuppliersStatus) && <CheckSuccess/>}
          {stageFailed(stakingStatus.requestSuppliersStatus) && <XIcon className={`fill-current text-[var(--color-destructive)]`}/>}
        </div>
        <div className="h-[1px] bg-[var(--slate-dividers)]"></div>
        <div className="flex flex-row justify-between items-center py-3 px-4">
          <span className="text-[14px]">Transactions Signature</span>
          {stageSucceeded(stakingStatus.transactionSignatureStatus) && <CheckSuccess/>}
          {stageFailed(stakingStatus.transactionSignatureStatus) && <XIcon className={`fill-current text-[var(--color-destructive)]`}/>}
        </div>
        <div className="h-[1px] bg-[var(--slate-dividers)]"></div>
        <div className="flex flex-row justify-between items-center py-3 px-4 font-size[14px]">
          <span className="text-[14px]">Scheduling Transactions</span>
          {stageSucceeded(stakingStatus.schedulingTransactionStatus) && <CheckSuccess/>}
          {stageFailed(stakingStatus.schedulingTransactionStatus) && <XIcon className={`fill-current text-[var(--color-destructive)]`}/>}
        </div>
        <div className="h-[1px] bg-[var(--slate-dividers)]"></div>
        <DialogFooter className="p-2">
          <DialogClose className="w-full" asChild>
            <Button
              disabled={!isCancellable}
              variant={'secondaryBorder'}
              type="submit">
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
