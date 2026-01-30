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
import React, {useMemo, useRef, useState} from "react";
import { UpsertApplicationSettings } from "@/actions/ApplicationSettings";
import type {ApplicationSettings} from "@igniter/db/provider/schema";
import { Textarea } from '@igniter/ui/components/textarea'
import { isPoktBech32Address } from '@/lib/crypto'
import { cn } from '@igniter/ui/lib/utils'

interface FormProps {
  defaultValues: Partial<ApplicationSettings>;
  goNext: () => void;
  goBack: () => void;
}

export const FormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  supportEmail: z.string().email().optional(),
  rewardAddresses: z.string().refine((value) => {
    if (!value) {
      return true;
    }

    const lines = value.trim().split(/[\n,\s]+/);
    const addresses = lines.map((line) => line.trim()).filter(isPoktBech32Address);

    return addresses.length !== 0
  }, 'There are no addresses in the list.')
    .refine((value) => {
      if (!value) {
        return true;
      }

      const lines = value.trim().split(/[\n,\s]+/);
      const addresses = lines.map((line) => line.trim()).filter(isPoktBech32Address);

     return addresses.length === lines.length;
  }, 'There are invalid addresses in the list.'),
});

type FormValues = z.infer<typeof FormSchema>;

const FormComponent: React.FC<FormProps> = ({ defaultValues, goNext, goBack }) => {
  console.log(defaultValues)
  const [isLoading, setIsLoading] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: defaultValues?.name || "",
      supportEmail: defaultValues?.supportEmail || "",
      rewardAddresses: defaultValues?.rewardAddresses?.join("\n") || ""
    },
  });

  const isUpdate = useMemo(() => defaultValues?.id !== 0, [defaultValues]);
  const formRef = useRef<HTMLFormElement>(null);

  const handleGoNext = () => {
    formRef.current?.requestSubmit();
  };

  return (
    <div className="flex flex-col justify-between gap-4">
      <Form {...form}>
        <form
          ref={formRef}
          onSubmit={form.handleSubmit(async (values: FormValues) => {
            setIsLoading(true);
            try {
              await UpsertApplicationSettings({
                ...values,
                rewardAddresses: values.rewardAddresses?.split(/[\n,\s]+/)?.filter(isPoktBech32Address) || []
              }, isUpdate);
              goNext();
            } catch (error) {
              console.error(error);
            } finally {
              setIsLoading(false);
            }
          })}
          className="grid gap-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <FormField
              name="name"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="supportEmail"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Support Email</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="rewardAddresses"
              control={form.control}
              render={({ field, fieldState: {error} }) => (
                <FormItem>
                  <FormLabel>Reward Addresses</FormLabel>
                  <FormControl>
                    <Textarea
                      id="rewardAddresses"
                      placeholder={`Enter one or more addresses (separated by new lines, commas, or spaces):

pokt1abc123def456ghi789jkl012mno345pqr678stu
pokt1xyz789abc123def456ghi789jkl012mno345pqr
pokt1def456ghi789jkl012mno345pqr678stu901vwx`}
                      {...field}
                      className="min-h-[140px] max-h-[260px] font-mono !text-[12px] border-[color:--divider] bg-[color:--background] placeholder:text-[color:--secondary]"
                    />
                  </FormControl>
                  <FormMessage className={cn(!error?.message ? 'text-xs! text-[color:var(--color-white-3)]' : null)}>
                    {error?.message ? error.message : (
                      <>
                        Used by Delegators to fetch your rewards. These must match the revenue‑share address(es) you provided to suppliers to receive rewards in the addresses group.
                        <br/>
                        The Delegators are going to validate that the domains staked match the domains you are going to configure. If it does not match, your rewards are not going to be shown to the users that want to stake in the Delegators.
                      </>
                    )}
                  </FormMessage>
                </FormItem>
              )}
            />
          </div>
        </form>
      </Form>
      <div className="flex justify-end gap-4">
        <Button
          disabled={isLoading}
          onClick={goBack}>
          Back
        </Button>
        <Button
          onClick={handleGoNext}
          disabled={isLoading}
        >
          {isLoading ? "Saving..." : "Next"}
        </Button>
      </div>
    </div>
  );
};

export default FormComponent;
