"use client";
import React, { useEffect, useState } from 'react'
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@igniter/ui/components/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@igniter/ui/components/form";
import { Checkbox } from "@igniter/ui/components/checkbox";
import { SyncProvidersFromGovernance, Provider, submitProviders } from '@/actions/Providers'
import { LoaderIcon } from '@igniter/ui/assets'

interface ProvidersFormProps {
  providers: Provider[];
  goNext: () => void;
  goBack: () => void;
}

const formSchema = z.object({
  providers: z.array(z.string()).refine((value) => value.some((item) => item), {
    message: "You have to select at least one provider.",
  }),
});

const ProvidersForm: React.FC<ProvidersFormProps> = ({
  goNext,
  goBack,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [providers, setProviders] = useState<Array<Provider>>([])
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      providers: providers.map((provider) => provider.identity),
    },
  });

  async function updateProvidersList() {
    try {
      setIsLoading(true)
      const { success, error, data: providersList } = await SyncProvidersFromGovernance()
      if(!success) throw new Error(
        error || "Failed to load providers list"
      )
      setProviders(providersList || [])
      if (!providers.length) {
        form.setValue('providers', (providersList || []).map((provider) => provider.identity))
      }
    } catch (error) {
      console.error("Failed to load providers list", error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    updateProvidersList()
  }, [])

  let content: React.ReactNode = null;

  if (isLoading) {
    content = (
      <div className="flex justify-center items-center w-full h-[300px]">
        <LoaderIcon className="animate-spin" />
      </div>
    )
  } else {
    content = (
      <form
        onSubmit={form.handleSubmit(async (values) => {
          setIsLoading(true);
          try {
            await submitProviders(values, providers);
            goNext();
          } catch (error) {
            console.error(error);
          } finally {
            setIsLoading(false);
          }
        })}
        className="flex flex-col gap-4"
      >
        <FormField
          control={form.control}
          name="providers"
          render={() => (
            <FormItem>
              <div className="rounded-md border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-muted-foreground">
                      <th className="p-3 w-10"></th>
                      <th className="p-3">Name</th>
                      <th className="p-3">Identity</th>
                      <th className="p-3">URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((item) => (
                      <FormField
                        key={item.identity}
                        control={form.control}
                        name="providers"
                        render={({ field }) => (
                          <tr
                            key={item.identity}
                            className="border-b last:border-0 hover:bg-muted/50 cursor-pointer"
                            onClick={() => {
                              const checked = field.value?.includes(item.identity);
                              if (checked) {
                                field.onChange(field.value?.filter((v) => v !== item.identity));
                              } else {
                                field.onChange([...field.value, item.identity]);
                              }
                            }}
                          >
                            <td className="p-3">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(item.identity)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([...field.value, item.identity])
                                      : field.onChange(field.value?.filter((v) => v !== item.identity));
                                  }}
                                />
                              </FormControl>
                            </td>
                            <td className="p-3 font-medium">{item.name}</td>
                            <td className="p-3 font-mono text-sm text-muted-foreground">
                              {item.identity.slice(0, 10)}...{item.identity.slice(-6)}
                            </td>
                            <td className="p-3 text-sm text-muted-foreground truncate max-w-[250px]">
                              {item.url}
                            </td>
                          </tr>
                        )}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-4">
          <Button variant="outline" onClick={goBack} disabled={isLoading}>
            Back
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Saving..." : "Next"}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <Form {...form}>
      {content}
    </Form>
  );
};

export default ProvidersForm;
