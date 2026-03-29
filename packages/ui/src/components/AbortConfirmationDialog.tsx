"use client";

import {Button} from "./button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogTitle,
} from "./dialog";
import {LoaderIcon} from "../assets";

export interface AbortConfirmationDialogProps {
    isOpen: boolean;
    onResponse: (abort: boolean) => void;
    type?: 'stake' | 'unstake' | 'migration' | 'import' | 'export' | 'generate';
    isLoading?: boolean;
}

export function AbortConfirmationDialog({ 
    isOpen, 
    onResponse, 
    type = 'stake', 
    isLoading = false 
}: Readonly<AbortConfirmationDialogProps>) {
    const typeLabel = type!.slice(0, 1).toUpperCase() + type!.slice(1)
    return (
        <Dialog open={isOpen}>
            <DialogContent
                onInteractOutside={(event) => event.preventDefault()}
                onEscapeKeyDown={(event) => event.preventDefault()}
                className="gap-0 w-[360px] p-0 rounded-lg bg-bg-surface border-border-primary"
                hideClose
            >
                <DialogTitle asChild>
                    <div className="flex flex-row justify-between items-center py-3 px-4">
                        <span className="text-[14px]">Abort {typeLabel}</span>
                    </div>
                </DialogTitle>
                <div className="h-[1px] bg-border-primary"></div>
                <div className="flex flex-row justify-between items-center py-3 px-4">
                    <span className="text-[14px] text-text-secondary">
                        Are you sure you want to abort this {type}? Be certain you can restart the {type} process anytime.
                    </span>
                </div>
                <div className="h-[1px] bg-border-primary"></div>
                <DialogFooter className="p-2 flex flex-row ">
                    <Button
                        variant={'secondaryStretch'}
                        onClick={() => onResponse(true)}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <LoaderIcon />
                        ) : (
                            <>Abort {typeLabel}</>
                        )}
                    </Button>
                    <Button
                        variant={'secondaryStretch'}
                        onClick={() => onResponse(false)}
                        disabled={isLoading}
                    >
                        Continue {typeLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
