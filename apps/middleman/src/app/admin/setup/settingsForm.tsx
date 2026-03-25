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
import { Textarea } from "@igniter/ui/components/textarea";
import React, {useMemo, useRef, useState} from "react";
import { UpsertApplicationSettings } from "@/actions/ApplicationSettings";
import {ApplicationSettings} from "@igniter/db/middleman/schema";
import {useNotifications} from "@igniter/ui/context/Notifications/index";

interface FormProps {
  defaultValues: Partial<ApplicationSettings>;
  goNext: () => void;
  goBack: () => void;
}

export const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  supportEmail: z.string().email().optional(),
  ownerEmail: z.string().email(),
  fee: z.coerce
    .number()
    .int("Service fee must be a whole number")
    .min(0, "Service fee must be greater or equal to 0")
    .max(100),
  delegatorRewardsAddress: z.string().refine(
    (value) => value.toLowerCase().startsWith('pokt') && value.length === 43,
    (val) => ({ message: `${val} is not a valid address` })
  ),
  privacyPolicy: z.string().optional(),
});

const FormComponent: React.FC<FormProps> = ({ defaultValues, goNext, goBack }) => {
  const [isLoading, setIsLoading] = useState(false);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: defaultValues.name || "",
      supportEmail: defaultValues.supportEmail || "",
      ownerEmail: defaultValues.ownerEmail || "",
      fee: Number(defaultValues.fee) || 1,
      privacyPolicy: defaultValues.privacyPolicy || "",
      delegatorRewardsAddress: defaultValues.delegatorRewardsAddress || "",
    },
  });

  const isUpdate = useMemo(() => defaultValues.id !== 0, [defaultValues]);

  const formRef = useRef<HTMLFormElement>(null);

  const { addNotification } = useNotifications();

  return (
    <div className="flex flex-col justify-between gap-4">
      <Form {...form}>
        <form
          ref={formRef}
          onSubmit={form.handleSubmit(async (values: any) => {
            setIsLoading(true);
            try {
              console.log('values:', values, isUpdate);
              await UpsertApplicationSettings(values, isUpdate);
              goNext();
            } catch (error) {
              console.error(error);
              addNotification({
                id: `settings-form-submit-error`,
                type: 'error',
                showTypeIcon: true,
                content: 'Failed to save settings. Please try again.',
              });
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              name="fee"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service Fee</FormLabel>
                  <FormControl>
                    <div className="flex items-center">
                      <Input {...field} type="number" className="flex-grow" />
                      <span className="ml-2">%</span>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="delegatorRewardsAddress"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Delegator rewards address</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              name="ownerEmail"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Owner Email</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            name="privacyPolicy"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Privacy Policy</FormLabel>
                <FormControl>
                  <Textarea className="resize-none h-[200px]" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>

      <div className="flex justify-end gap-4">
        <Button
          variant="outline"
          onClick={goBack}
        >
          Back
        </Button>
        <Button
          onClick={() => formRef.current?.requestSubmit()}
          disabled={isLoading}>
          {isLoading ? "Saving..." : "Next"}
        </Button>
      </div>
    </div>
  );
};

export default FormComponent;
