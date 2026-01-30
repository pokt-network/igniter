'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import { readFile } from '@/app/admin/(internal)/keys/import/utils'
import { ImportKeys } from '@/actions/Keys'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@igniter/ui/components/dialog'
import { Button } from '@igniter/ui/components/button'
import { CheckSuccess, LoaderIcon, XIcon } from '@igniter/ui/assets'
import { FileWarning } from 'lucide-react'
import {useNotifications} from "@igniter/ui/context/Notifications/index";
import {isValidPrivateKey} from '@igniter/pocket/utils';
type StageStatus = 'pending' | 'success' | 'error' | 'invalid';

export interface ImportProcessStatus {
  validateFile: StageStatus;
  importKeys: StageStatus;
}

enum ImportProcessStep {
  ValidateFile,
  ImportingKeys,
  Completed,
}

interface ImportProcessProps {
  addressGroupId: string
  file: File
  onImportCompleted: (status: ImportProcessStatus, keysImported?: number) => void
}

const KeysSchema = z.array(z.string().refine(isValidPrivateKey))

export default function ImportProcess({file, addressGroupId, onImportCompleted}: ImportProcessProps) {
  const [open, setOpen] = useState(false);
  const [isCancellable, setIsCancellable] = useState<boolean>(true);
  const [currentStep, setCurrentStep] = useState<ImportProcessStep>(ImportProcessStep.ValidateFile);
  const [importStatus, setImportStatus] = useState<ImportProcessStatus>({
    validateFile: 'pending',
    importKeys: 'pending',
  });
  const [keys, setKeys] = useState<Array<string>>([]);
  const { addNotification } = useNotifications();

  function handleOpenChanged(open: boolean) {
    setOpen(open);

    if (!open) {
      setCurrentStep(ImportProcessStep.ValidateFile);
      setImportStatus({
        validateFile: 'pending',
        importKeys: 'pending',
      });
    }
    setIsCancellable(false);
  }

  function handleFailedStage(stageName: keyof ImportProcessStatus, message?: string) {
    setImportStatus((prev) => ({
      ...prev,
      [stageName]: 'error',
    }));

    setTimeout(() => {
      setImportStatus(currentStatus => {
        onImportCompleted(currentStatus);
        handleOpenChanged(false);
        return currentStatus;
      });

      if (message) {
        addNotification({
          id: `import-keys-process-${stageName}-error`,
          type: 'error',
          showTypeIcon: true,
          content: message,
        });
      }
    }, 1000);
  }

  const validateFile = async () => {
    try {
      const keys = KeysSchema.parse(JSON.parse(await readFile(file)))

      setIsCancellable(false)

      setImportStatus({
        validateFile: 'success',
        importKeys: 'pending',
      })

      setKeys(keys)
      setImportStatus({
        validateFile: 'success',
        importKeys: 'pending',
      })
      setCurrentStep(ImportProcessStep.ImportingKeys)
    } catch (e) {
      if (e instanceof SyntaxError || e instanceof z.ZodError) {
        console.log('invalid file:', e)
        setImportStatus({
          validateFile: 'invalid',
          importKeys: 'pending',
        })

        setTimeout(() => {
          setImportStatus(currentStatus => {
            onImportCompleted(currentStatus);
            handleOpenChanged(false);
            return currentStatus;
          });
        }, 2000);
      } else {
        handleFailedStage('validateFile', 'The file you\'re trying to import is invalid.');
      }
    }
  }

  const importKeys = async () => {
    try {
      const result = await ImportKeys(keys, parseInt(addressGroupId))

      if (!result.success) {
        throw new Error(result.error.message);
      }

      setImportStatus({
        validateFile: 'success',
        importKeys: 'success',
      })
      setCurrentStep(ImportProcessStep.Completed)
    } catch (e) {
      if ((e as Error).message.includes('already exists')) {
        setImportStatus({
          validateFile: 'success',
          importKeys: 'invalid',
        })
        setTimeout(() => {
          setImportStatus(currentStatus => {
            onImportCompleted(currentStatus);
            handleOpenChanged(false);
            return currentStatus;
          });
        }, 2000);
      } else {
        handleFailedStage('importKeys', 'An unknown error occurred while importing keys. Please try again. Contact support if the issue persists.');
      }
    }
  }

  const onCompleted = () => {
    setTimeout(() => {
      onImportCompleted(importStatus, keys.length)
      setOpen(false)
    }, 1000)
  }

  useEffect(() => {
    if (!open) {
      return
    }

    if (currentStep === ImportProcessStep.ValidateFile && importStatus.validateFile !== 'success') {
      validateFile()
    }

    if (currentStep === ImportProcessStep.ImportingKeys && importStatus.importKeys !== 'success') {
      importKeys()
    }

    if (currentStep === ImportProcessStep.Completed) {
      onCompleted()
    }
  }, [open, currentStep])

  return (
    <Dialog open={open} onOpenChange={handleOpenChanged}>
      <DialogTrigger asChild>
        <Button>Import Keys</Button>
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
        <div className="h-[1px] bg-[var(--slate-dividers)]"/>
        <div className="flex flex-row justify-between items-center py-3 px-4">
          <span className="text-[14px]">{importStatus.validateFile === 'invalid' ? 'Invalid File' : 'Validating File'}</span>
          {importStatus.validateFile === 'invalid' && <FileWarning className={'text-[color:var(--warning)] w-4 h-4'} />}
          {importStatus.validateFile === 'success' && <CheckSuccess/>}
          {importStatus.validateFile === 'error' && <XIcon className={`fill-current text-[var(--color-destructive)]`}/>}
        </div>
        <div className="h-[1px] bg-[var(--slate-dividers)]"/>
        <div className="flex flex-row justify-between items-center py-3 px-4">
          <span className="text-[14px]">{importStatus.importKeys === 'invalid' ? 'Keys Already Exists' : 'Importing Keys'}</span>
          {importStatus.importKeys === 'invalid' && <FileWarning className={'text-[color:var(--warning)] w-4 h-4'} />}
          {importStatus.importKeys === 'success' && <CheckSuccess/>}
          {importStatus.importKeys === 'error' && <XIcon className={`fill-current text-[var(--color-destructive)]`}/>}
        </div>
        <div className="h-[1px] bg-[var(--slate-dividers)]"/>
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
  )
}
