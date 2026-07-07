'use client'

import React, { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@igniter/ui/components/dialog'

export interface ConfirmationDialogProps {
  /** The title to display in the dialog */
  title: string
  /** Whether the dialog is currently open */
  open: boolean
  /** Callback when the dialog is closed */
  onClose: () => void
  /** Content to display in the dialog body */
  children?: ReactNode
  /** Actions to display in the dialog footer (usually confirm/cancel buttons) */
  footerActions?: ReactNode
  /** Optional class name for the dialog content */
  className?: string
}

export function ConfirmationDialog({
  title,
  open,
  onClose,
  children,
  footerActions,
  className,
}: Readonly<ConfirmationDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={className} aria-describedby={undefined}>
        <DialogTitle>{title}</DialogTitle>

        {children}

        {footerActions && <DialogFooter>{footerActions}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}