"use client";

import { Button } from "@igniter/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@igniter/ui/components/dialog";
import { useEffect, useState } from "react";
import { CheckSuccess, LoaderIcon, XIcon } from "@igniter/ui/assets";
import { Transaction as DbTransaction } from "@igniter/db/middleman/schema";
import { SignedTransaction, TransactionMessage } from "@/lib/models/Transactions";
import { useWalletConnection } from "@igniter/ui/context/WalletConnection/index";
import { StageStatus } from "@/app/app/unstake/types";
import { stageFailed, stageSucceeded } from "@/app/app/unstake/utils";
import { useNotifications } from "@igniter/ui/context/Notifications/index";
import { CreateUnstakeTransaction } from '@/actions/Unstake'

export interface UnstakingProcessStatus {
  transactionSignatureStatus: StageStatus;
  schedulingTransactionStatus: StageStatus;
}

export interface UnstakingProcessProps {
  selectedNodeAddresses: string[];
  ownerAddress: string;
  onUnstakeCompleted: (result: UnstakingProcessStatus, transaction?: DbTransaction) => void;
  disabled?: boolean;
}

enum UnstakingProcessStep {
  transactionSignature,
  SchedulingTransaction,
  Completed
}

export function UnstakingProcess({
  selectedNodeAddresses,
  onUnstakeCompleted,
  ownerAddress,
  disabled
}: Readonly<UnstakingProcessProps>) {
  const [open, setOpen] = useState(false);
  const [isCancellable, setIsCancellable] = useState<boolean>(true);
  const [unstakingStatus, setUnstakingStatus] = useState<UnstakingProcessStatus>({
    transactionSignatureStatus: 'pending',
    schedulingTransactionStatus: 'pending',
  });
  const [currentStep, setCurrentStep] = useState<UnstakingProcessStep>(UnstakingProcessStep.transactionSignature);
  const { signTransaction } = useWalletConnection();
  const [transaction, setTransaction] = useState<DbTransaction | null>(null);
  const [signedTransaction, setSignedTransaction] = useState<SignedTransaction | null>(null);
  const { addNotification } = useNotifications();

  useEffect(() => {
    (async () => {
      if (!open || currentStep !== UnstakingProcessStep.transactionSignature) {
        return;
      }

      try {
        // Create unstake messages for each selected node
        const unstakeMessages: TransactionMessage[] = selectedNodeAddresses.map((operatorAddress) => ({
          typeUrl: '/pocket.supplier.MsgUnstakeSupplier',
          body: {
            operatorAddress,
            signer: ownerAddress,
          },
        }));

        const signedTx = await signTransaction(unstakeMessages, ownerAddress, undefined);

        setSignedTransaction(signedTx);

        setUnstakingStatus((prev) => ({
          ...prev,
          transactionSignatureStatus: 'success',
        }));

        setIsCancellable(false);

        setCurrentStep(UnstakingProcessStep.SchedulingTransaction);
      } catch (err) {
        const { message } = err as Error;
        console.log('An error occurred while collecting the signature. Error:', message);
        handleFailedStage(
          'transactionSignatureStatus',
          'An unknown error occurred while collecting your signature for the transaction. If it was intentionally rejected, this is required in order to proceed. If not, please make sure you have a supported wallet extension enabled. You have incurred no fees. You can try again. If the problem persists, please contact support.'
        );
      }
    })();
  }, [open, currentStep]);

  useEffect(() => {
    (async () => {
      if (!open || currentStep !== UnstakingProcessStep.SchedulingTransaction) {
        return;
      }

      try {
        const createdTransaction = await CreateUnstakeTransaction({
          transaction: signedTransaction!,
        })

        setTransaction(createdTransaction)
        // Placeholder: Mark as success
        setUnstakingStatus((prev) => ({
          ...prev,
          schedulingTransactionStatus: 'success',
        }));

        setCurrentStep(UnstakingProcessStep.Completed);
      } catch (err) {
        const { message } = err as Error;
        console.log('An error occurred while scheduling the signed transactions. Error:', message);
        handleFailedStage(
          'schedulingTransactionStatus',
          'An unknown error occurred while scheduling the signed transactions.'
        );
      }
    })();
  }, [open, currentStep]);

  useEffect(() => {
    if (open && currentStep === UnstakingProcessStep.Completed) {
      setTimeout(() => {
        onUnstakeCompleted(
          {
            ...unstakingStatus,
          },
          transaction!
        );
        setOpen(false);
      }, 1000);
    }
  }, [open, currentStep]);

  function handleOpenChanged(open: boolean) {
    setOpen(open);

    if (!open) {
      let newStep: UnstakingProcessStep;

      if (unstakingStatus.transactionSignatureStatus !== 'success') {
        newStep = UnstakingProcessStep.transactionSignature;
      } else if (unstakingStatus.schedulingTransactionStatus !== 'success') {
        newStep = UnstakingProcessStep.SchedulingTransaction;
      } else {
        newStep = UnstakingProcessStep.Completed;
      }

      setCurrentStep(newStep);

      let newUnstakingStatus: UnstakingProcessStatus;

      if (newStep === UnstakingProcessStep.transactionSignature) {
        newUnstakingStatus = {
          transactionSignatureStatus: 'pending',
          schedulingTransactionStatus: 'pending',
        };
      } else if (newStep === UnstakingProcessStep.SchedulingTransaction) {
        newUnstakingStatus = {
          transactionSignatureStatus: 'success',
          schedulingTransactionStatus: 'pending',
        };
      } else {
        // return if every step was completed
        return;
      }

      setUnstakingStatus(newUnstakingStatus);
      setIsCancellable(false);
    } else {
      if (currentStep === UnstakingProcessStep.Completed) {
        return;
      } else if (currentStep === UnstakingProcessStep.transactionSignature) {
        setUnstakingStatus({
          transactionSignatureStatus: 'pending',
          schedulingTransactionStatus: 'pending',
        });
      } else if (currentStep === UnstakingProcessStep.SchedulingTransaction) {
        setUnstakingStatus({
          transactionSignatureStatus: 'success',
          schedulingTransactionStatus: 'pending',
        });
      }

      setIsCancellable(true);
    }
  }

  function handleFailedStage(stageName: keyof UnstakingProcessStatus, message?: string) {
    setUnstakingStatus((prev) => ({
      ...prev,
      [stageName]: 'error',
    }));

    setTimeout(() => {
      setUnstakingStatus((currentStatus) => {
        onUnstakeCompleted(currentStatus);
        handleOpenChanged(false);
        return currentStatus;
      });

      if (message) {
        addNotification({
          id: `unstake-process-${stageName}-error`,
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
        <Button disabled={disabled}>Unstake</Button>
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
            <LoaderIcon className="animate-spin" />
          </div>
        </DialogTitle>
        <div className="h-[1px] bg-[var(--slate-dividers)]"></div>
        <div className="flex flex-row justify-between items-center py-3 px-4">
          <span className="text-[14px]">Transaction Signature</span>
          {stageSucceeded(unstakingStatus.transactionSignatureStatus) && <CheckSuccess />}
          {stageFailed(unstakingStatus.transactionSignatureStatus) && (
            <XIcon className={`fill-current text-[var(--color-destructive)]`} />
          )}
        </div>
        <div className="h-[1px] bg-[var(--slate-dividers)]"></div>
        <div className="flex flex-row justify-between items-center py-3 px-4 font-size[14px]">
          <span className="text-[14px]">Scheduling Transaction</span>
          {stageSucceeded(unstakingStatus.schedulingTransactionStatus) && <CheckSuccess />}
          {stageFailed(unstakingStatus.schedulingTransactionStatus) && (
            <XIcon className={`fill-current text-[var(--color-destructive)]`} />
          )}
        </div>
        <div className="h-[1px] bg-[var(--slate-dividers)]"></div>
        <DialogFooter className="p-2">
          <DialogClose className="w-full" asChild>
            <Button disabled={!isCancellable} variant={'secondaryBorder'} type="submit">
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
