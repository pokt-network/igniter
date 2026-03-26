"use client";
import { Button } from "@igniter/ui/components/button";
import { Progress } from "@igniter/ui/components/progress";
import {CheckIcon, LoaderIcon} from "@igniter/ui/assets";
import { Skeleton } from "@igniter/ui/components/skeleton";
import { defineStepper } from "@stepperize/react";
import React, {useEffect} from "react";
import { cn } from "@igniter/ui/lib/utils";
import { ApplicationSettings } from "@igniter/db/middleman/schema";
import {completeSetup, getApplicationSettings} from "@/actions/ApplicationSettings";
import ApplicationSettingsForm from "./settingsForm";
import { Provider } from "@/actions/Providers";
import ProvidersForm from "./providersForm";
import BlockchainFormComponent from '@/app/admin/setup/blockchainFrom'

interface StepperProps {
  providers: Provider[];
  settings: Partial<ApplicationSettings>;
}

const { useStepper, steps, utils } = defineStepper(
  {
    id: "blockchain",
    title: "Blockchain Settings",
  },
  {
    id: "application-settings",
    title: "Application Settings and Branding",
  },
  {
    id: "configure-providers",
    title: "Configure Providers",
  },
  {
    id: "complete-bootstrap",
    title: "Complete",
  }
);

const AdminUserComponent = ({ address }: { address: string }) => {
  return (
    <div className="grid gap-4">
      <h4>
        System owner created with address:{" "}
        <span className="font-mono text-sm">{address}</span>{" "}
      </h4>
    </div>
  );
};

const ApplicationSettingsComponent: React.FC<{
  settings: Partial<ApplicationSettings>;
  goNext: () => void;
  goBack: () => void;
}> = ({ settings, goNext, goBack }) => {
  return (
    <div className="grid gap-4">
      <ApplicationSettingsForm
        defaultValues={settings}
        goNext={goNext}
        goBack={goBack}
      />
    </div>
  );
};

const ProvidersComponent: React.FC<{
  providers: Provider[];
  goNext: () => void;
  goBack: () => void;
}> = ({ providers, goNext, goBack }) => {
  return (
    <div className="grid gap-4">
      <h4>Select supported providers from list:</h4>
      <ProvidersForm providers={providers} goNext={goNext} goBack={goBack} />
    </div>
  );
};

const BootstrapCompleteComponent = () => {
  return <h3 className="text-lg py-4">System Bootstrap complete!</h3>;
};

export const Stepper: React.FC<StepperProps> = ({ providers }) => {
  const stepper = useStepper();
  const [isLoadingSettings, setIsLoadingSettings] = React.useState(true);
  const [hasError, setHasError] = React.useState(false);
  const [settings, setSettings] = React.useState<ApplicationSettings>();

  const currentIndex = utils.getIndex(stepper.current.id);

  const updateSettingsFromDb = async () => {
    setHasError(false);
    setSettings(undefined);
    try {
      setIsLoadingSettings(true);
      const dbSettings = await getApplicationSettings();
      setSettings(dbSettings as ApplicationSettings);
    } catch (error) {
      console.error("Something went wrong while retrieving the current applications settings", error);
      setHasError(true);
    } finally {
      setIsLoadingSettings(false);
    }
  };

  useEffect(() => {
    updateSettingsFromDb();
  }, [currentIndex]);

  return (
    <div className="space-y-6 p-6 border rounded-lg h-[calc(100vh-120px)] flex flex-col">
        <div className="flex flex-col gap-5">
          <div className="flex justify-between">
            <h2 className="text-lg font-medium">System Setup</h2>
          </div>
          <nav aria-label="Bootstrap Steps" className="group my-4">
            <ol
              className="flex items-center justify-between gap-5"
              aria-orientation="horizontal"
            >
              {stepper.all.map((step, index) => (
                <React.Fragment key={step.id}>
                  <li className="flex flex-col items-center gap-4 flex-shrink-0">
                    <Button
                      type="button"
                      role="tab"
                      aria-current={
                        stepper.current.id === step.id ? "step" : undefined
                      }
                      aria-posinset={index + 1}
                      aria-setsize={steps.length}
                      aria-selected={stepper.current.id === step.id}
                      className={cn(
                        "flex size-11 items-center justify-center rounded-full border pointer-events-none",
                        {
                          "bg-accent/70 ring-2 ring-accent/70 ring-offset-3 ring-offset-background":
                            stepper.current.id === step.id,
                          "bg-success/70": index < currentIndex,
                          "bg-primary": index > currentIndex,
                        }
                      )}
                    >
                      {index < currentIndex ? <CheckIcon /> : null}
                    </Button>
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-sm text-text-secondary tracking-wider uppercase">
                        Step {index + 1}
                      </span>
                      <span className="text-md text-secondary-foreground font-medium">
                        {step.title}
                      </span>
                      <span
                        className={cn(
                          "text-sm",
                          index < currentIndex
                            ? "text-success"
                            : index === currentIndex
                              ? "text-accent"
                              : "text-text-secondary"
                        )}
                      >
                        {index < currentIndex
                          ? "Completed"
                          : index === currentIndex
                            ? "In Progress"
                            : "Pending"}
                      </span>
                    </div>
                  </li>
                  {index < stepper.all.length - 1 && (
                    <li className="flex-grow">
                      <Progress
                        value={
                          index < currentIndex
                            ? 100
                            : index === currentIndex
                              ? 50
                              : 0
                        }
                        className={cn("w-[80%] m-auto", {
                          "[&>*]:bg-success/70": index < currentIndex,
                        })}
                      />
                    </li>
                  )}
                </React.Fragment>
              ))}
            </ol>
          </nav>
        </div>

        <div className="space-y-5 flex-1 overflow-y-auto">
          {isLoadingSettings && (
            <div className="flex flex-col gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <div className="flex flex-col gap-2.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
              <div className="flex flex-col gap-2.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-3 w-64" />
              </div>
              <div className="flex justify-end gap-4">
                <Skeleton className="h-9 w-16 rounded-md" />
                <Skeleton className="h-9 w-16 rounded-md" />
              </div>
            </div>
          )}
          {hasError && (
            <div className="flex justify-center items-center h-fit">
              <p>Something went wrong while retrieving the current applications settings</p>
              <Button>
                Try again
              </Button>
            </div>
          )}
          {!isLoadingSettings && !hasError && stepper.switch({
            "blockchain": () => (
              <BlockchainFormComponent
                defaultValues={settings!}
                goNext={stepper.next}
              />
            ),
            "application-settings": () => (
              <ApplicationSettingsComponent
                settings={settings!}
                goNext={stepper.next}
                goBack={stepper.prev}
              />
            ),
            "configure-providers": () => (
              <ProvidersComponent
                providers={providers}
                goNext={stepper.next}
                goBack={stepper.prev}
              />
            ),
            "complete-bootstrap": () => <BootstrapCompleteComponent />,
          })}
        </div>

        {stepper.current.id === "complete-bootstrap" && (
          <div className="flex justify-end gap-4">
            <Button onClick={completeSetup}>Complete</Button>
          </div>
        )}
      </div>
  );
};
