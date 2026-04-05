
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
import React, {useMemo, useRef, useState} from "react";
import { UpsertApplicationSettings } from "@/actions/ApplicationSettings";
import type {ApplicationSettings} from "@igniter/db/provider/schema";
import { Textarea } from '@igniter/ui/components/textarea'
import { isPoktBech32Address } from '@igniter/commons/crypto'
import { cn } from '@igniter/ui/lib/utils'
import { SetupHelpBar } from "@/components/SetupHelpBar"

interface FormProps {
  defaultValues: Partial<ApplicationSettings>;
  goNext: () => void;
  goBack: () => void;
}

export const FormSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
  supportEmail: z.string().email("Please enter a valid email address").optional().or(z.literal("")),
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
                  <FormLabel>Provider Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., My POKT Provider" />
                  </FormControl>
                  <FormDescription>
                    Displayed to delegators and stakers.
                  </FormDescription>
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
                    <Input {...field} placeholder="e.g., support@mycompany.com" />
                  </FormControl>
                  <FormDescription>
                    Optional contact email shown to delegators.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            name="rewardAddresses"
            control={form.control}
            render={({ field, fieldState: {error} }) => (
              <FormItem>
                <FormLabel>Reward Addresses</FormLabel>
                <FormControl>
                  <Textarea
                    id="rewardAddresses"
                    placeholder={`pokt1abc123def456ghi789jkl012mno345pqr678stu\npokt1xyz789abc123def456ghi789jkl012mno345pqr`}
                    {...field}
                    className="min-h-[100px] max-h-[200px] font-mono !text-[12px] border-border-primary bg-bg-root placeholder:text-text-tertiary"
                  />
                </FormControl>
                <FormMessage className={cn(!error?.message ? 'text-xs! text-text-secondary' : null)}>
                  {error?.message ? error.message : 'One or more pokt1... addresses where you receive relay rewards. Must match your address group rev-share config.'}
                </FormMessage>
              </FormItem>
            )}
          />
        </form>
      </Form>

      <SetupHelpBar docAnchor="step-2--identity-settings" />

      <div className="flex justify-end gap-4">
        <Button
          variant="outline"
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
