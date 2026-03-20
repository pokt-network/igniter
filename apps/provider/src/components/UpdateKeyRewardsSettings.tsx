"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@igniter/ui/components/button";
import {
  Form,
  FormControl,
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
import type { Key } from "@igniter/db/provider/schema";
import { UpdateKeyRewardsSettings as UpdateKeyRewardsSettingsAction } from "@/actions/Keys";

const poktAddressRegex = /^pokt[a-zA-Z0-9]{39,42}$/;

const UpdateRewardsSchema = z.object({
  delegatorRewardsAddress: z
    .string()
    .min(1, "Rewards address is required")
    .regex(
      poktAddressRegex,
      "Must be a valid Cosmos address with 'pokt' prefix",
    ),
  delegatorRevSharePercentage: z
    .coerce
    .number()
    .min(0, "Min 0%")
    .max(100, "Max 100%"),
});

export interface UpdateKeyRewardsSettingsProps {
  onClose?: (updated: boolean) => void;
  keyId: Key["id"];
  defaults?: Pick<
    Key,
    "delegatorRewardsAddress" | "delegatorRevSharePercentage"
  >;
}

export function UpdateKeyRewardsSettings({
  onClose,
  keyId,
  defaults,
}: Readonly<UpdateKeyRewardsSettingsProps>) {
  const [isCancelling, setIsCanceling] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof UpdateRewardsSchema>>({
    resolver: zodResolver(UpdateRewardsSchema),
    defaultValues: {
      delegatorRewardsAddress: defaults?.delegatorRewardsAddress ?? "",
      delegatorRevSharePercentage: defaults?.delegatorRevSharePercentage ?? 0,
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

  async function onSubmit(values: z.infer<typeof UpdateRewardsSchema>) {
    setError(null);
    setIsSubmitting(true);
    try {
      await UpdateKeyRewardsSettingsAction(keyId, values);
      onClose?.(true);
    } catch (e) {
      console.error("Failed to update key rewards settings", e);
      setError(
        e instanceof Error
          ? e.message
          : "There has been an error updating the key rewards settings. Please, try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={true}>
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        className="gap-0 p-0 rounded-lg bg-bg-elevated !w-[500px] !min-w-none !max-w-none"
        hideClose
      >
        <DialogTitle asChild>
          <div className="flex flex-row justify-between items-center py-4 px-4">
            <span className="text-[14px]">Update Delegator Rewards Settings</span>
          </div>
        </DialogTitle>
        {!error && <div className="h-[1px] bg-[var(--slate-dividers)]" />}
        {error && (
          <div className={"flex flex-col items-center bg-bg-root"}>
            <div className={"flex items-center"}>
              <div className={"flex flex-row items-center p-1"}>{error}</div>
            </div>
            <div className="!min-h-0.5 !h-[2px] w-full bg-linear-to-r from-[color:#f97834] to-[color:#f8a23e]" />
          </div>
        )}
        <div className="px-4 py-3">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <div className="flex flex-col gap-4">
                <FormField
                  name="delegatorRewardsAddress"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-2">
                      <FormLabel>Delegator Rewards Address</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="pokt…" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  name="delegatorRevSharePercentage"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem className="flex flex-col gap-2">
                      <FormLabel>Delegator Rev Share (%)</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} max={100} step={1} {...field} />
                      </FormControl>
                      <div className="text-text-tertiary text-xs">
                        Percentage of rewards the delegator expects to receive.
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter className="pt-4">
                <Button variant="outline" onClick={handleCancel} disabled={isSubmitting} type="button">
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />}
                  Update
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>

        {isCancelling && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
            <div className="bg-bg-elevated p-4 rounded-lg w-[300px]">
              <h3 className="text-lg font-medium mb-2">Discard changes?</h3>
              <p className="mb-4">You have unsaved changes. Are you sure you want to discard them?</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsCanceling(false)}>
                  Keep editing
                </Button>
                <Button onClick={() => onClose?.(false)}>Discard</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default UpdateKeyRewardsSettings;
