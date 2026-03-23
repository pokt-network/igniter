"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@igniter/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@igniter/ui/components/form";
import { Input } from "@igniter/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@igniter/ui/components/dialog";
import React, { useCallback, useState } from "react";
import { LoaderIcon } from "@igniter/ui/assets";
import type { Region } from "@igniter/db/provider/schema";
import { CreateRegion, UpdateRegion } from "@/actions/Regions";

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded-sm border border-border-subtle bg-bg-surface px-1 py-0.5 font-mono text-[11px] text-text-primary">
    {children}
  </code>
);

const CreateOrUpdateRegionSchema = z.object({
  displayName: z
    .string()
    .min(1, "Display name is required")
    .max(20, "Display name cannot exceed 20 characters"),

  urlValue: z
    .string()
    .min(1, "URL value is required")
    .max(20, "URL value cannot exceed 20 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Only lowercase letters, numbers, and hyphens are allowed"
    ),
});

export interface AddOrUpdateRegionProps {
  onClose?: (shouldRefreshRegions: boolean) => void;
  region?: Region;
}

export function AddOrUpdateRegionDialog({
  onClose,
  region,
}: Readonly<AddOrUpdateRegionProps>) {
  const [isCancelling, setIsCanceling] = useState(false);
  const [isCreatingRegion, setIsCreatingRegion] = useState(false);
  const [isUpdatingRegion, setIsUpdatingRegion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof CreateOrUpdateRegionSchema>>({
    resolver: zodResolver(CreateOrUpdateRegionSchema),
    defaultValues: {
      displayName: region?.displayName ?? "",
      urlValue: region?.urlValue ?? "",
    },
  });

  const handleCancel = useCallback(() => {
    const formValues = form.getValues();
    const defaultValues = form.formState.defaultValues;
    const isDirty = JSON.stringify(formValues) !== JSON.stringify(defaultValues);

    if (isDirty) {
      setIsCanceling(true);
    } else {
      onClose?.(false);
    }
  }, [onClose, form]);

  async function onSubmit(values: z.infer<typeof CreateOrUpdateRegionSchema>) {
    setError(null);
    if (region) {
      setIsUpdatingRegion(true);
      try {
        const result = await UpdateRegion(region.id, values);
        if (!result.success) {
          throw new Error(result.error.message);
        }
        onClose?.(true);
      } catch (e) {
        console.error("Failed to update region", e);
        setError('There has been an error updating the region. Please, try again.');
      } finally {
        setIsUpdatingRegion(false);
      }
    } else {
      setIsCreatingRegion(true);
      try {
        const result = await CreateRegion(values);
        if (!result.success) {
          throw new Error(result.error.message);
        }
        onClose?.(true);
      } catch (e) {
        console.error("Failed to create region", e);
        setError('There has been an error creating the region. Please, try again.');
      } finally {
        setIsCreatingRegion(false);
      }
    }
  }

  const isLoading = isCreatingRegion || isUpdatingRegion;

  return (
    <Dialog open={true}>
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        className="gap-0 p-0 rounded-lg bg-bg-elevated !w-[500px] !min-w-none !max-w-none"
        hideClose
      >
        <DialogTitle asChild>
          <div className="flex flex-row justify-between items-center py-4 px-4">
            <span className="text-[14px]">
              {region
                ? `Update Region: ${region.displayName}`
                : "Add New Region"}
            </span>
          </div>
        </DialogTitle>
        {!error && (
            <div className="h-[1px] bg-[var(--slate-dividers)]" />
        )}
        {error && (
            <div
                className={'flex flex-col items-center bg-bg-root'}
            >
              <div className={'flex items-center'}>
                <div className={'flex flex-row items-center p-1'}>
                  {error}
                </div>
              </div>
              <div className="!min-h-0.5 !h-[2px] w-full bg-linear-to-r from-[color:#f97834] to-[color:#f8a23e]" />
            </div>
        )}
        <div className="px-4 py-3">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <div className="flex flex-col gap-4">
                {/* Display Name */}
                <FormField
                  name="displayName"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-2">
                      <FormLabel>Display Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., US East" maxLength={20} />
                      </FormControl>
                      <FormDescription>
                        A human-readable label for this region. Shown in dropdowns and tables. Max 20 characters.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* URL Value */}
                <FormField
                  name="urlValue"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-2">
                      <FormLabel>URL Value</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., us-east" maxLength={20} />
                      </FormControl>
                      <FormDescription className={'leading-5'}>
                        This value is used as the <Code>{'{region}'}</Code> token when building service endpoint URLs for suppliers. The URL pattern is:
                        <br/>
                        <Code>{'{scheme}://{region}-{rm}-{sid}-{protocol}.{domain}'}</Code>
                        <br/>
                        For example, with URL value <Code>us-east</Code> the endpoint becomes:
                        <br/>
                        <Code>{'https://us-east-{rm}-{sid}-{protocol}.{domain}'}</Code>
                        <br/>
                        <b className={'mt-1 inline-block'}>Max 20 characters. Only lowercase letters, numbers, and hyphens are allowed.</b>

                        {region && (
                          <>
                            <br/>
                            <strong>Warning:</strong> this value may already be part of staked supplier URLs. Changing it will require those suppliers to be re-staked.
                          </>
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="pt-4">
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isLoading}
                  type="button"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading && (
                    <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {region ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>

        {isCancelling && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
            <div className="bg-bg-elevated p-4 rounded-lg w-[300px]">
              <h3 className="text-lg font-medium mb-2">Discard changes?</h3>
              <p className="mb-4">
                You have unsaved changes. Are you sure you want to discard them?
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsCanceling(false)}
                >
                  Continue Editing
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => onClose?.(false)}
                >
                  Discard
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
