"use client";
import { Button } from "@igniter/ui/components/button";
import { Progress } from "@igniter/ui/components/progress";
import {CheckIcon, LoaderIcon} from "@igniter/ui/assets";
import { Skeleton } from "@igniter/ui/components/skeleton";
import { defineStepper } from "@stepperize/react";
import React, {useEffect} from "react";
import { cn } from "@igniter/ui/lib/utils";
import type { ApplicationSettings } from "@igniter/db/provider/schema";
import { completeSetup, GetApplicationSettings } from "@/actions/ApplicationSettings";
import { ListRegions } from "@/actions/Regions";
import { ListServices } from "@/actions/Services";
import { ListAddressGroups } from "@/actions/AddressGroups";
import { ListRelayMiners } from "@/actions/RelayMiners";
import { ListDelegators } from "@/actions/Delegators";
import ConfigureAppSettings from "./ConfigureAppSettings";
import ConfigureAddressGroup from "./ConfigureAddressGroups";
import ConfigureServices from "@/app/admin/setup/ConfigureServices";
import ConfigureDelegators from "@/app/admin/setup/ConfigureDelegators";
import ConfigureBlockChain from "@/app/admin/setup/ConfigureBlockChain";
import ConfigureRelayMiners from "@/app/admin/setup/ConfigureRelayMiners";
import ConfigureRegions from "@/app/admin/setup/ConfigureRegions";

const { useStepper, steps, utils } = defineStepper(
  {
    id: "blockchain",
    title: "Blockchain Settings",
  },
  {
    id: "identity-settings",
    title: "Identity Settings",
  },
  {
    id: "regions",
    title: "Configure Regions"
  },
  {
    id: "relay-miners",
    title: "Configure Relay-miners"
  },
  {
    id: "services",
    title: "Select Provided Services",
  },
  {
    id: "address-groups",
    title: "Address Groups",
  },
  {
    id: "delegators",
    title: "Delegators",
  },
  {
    id: "complete-bootstrap",
    title: "Finish",
  }
);

const BootstrapSummary = ({ settings }: { settings?: ApplicationSettings }) => {
  const [counts, setCounts] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    (async () => {
      const [regions, relayMiners, services, addressGroups, delegators] = await Promise.all([
        ListRegions().then(r => r.success ? r.data.length : 0),
        ListRelayMiners().then(r => r.success ? r.data.length : 0),
        ListServices().then(r => r.success ? r.data.length : 0),
        ListAddressGroups().then(r => r.success ? r.data.length : 0),
        ListDelegators().then(r => r.success ? r.data.length : 0),
      ]);
      setCounts({ regions, relayMiners, services, addressGroups, delegators });
    })();
  }, []);

  return (
    <div className="flex flex-col gap-6 py-4">
      <div>
        <h3 className="text-lg font-semibold">Setup Complete</h3>
        <p className="text-sm text-text-secondary mt-1">
          Your provider is configured and ready to go. Click Complete to finalize.
        </p>
      </div>

      {settings && (
        <div className="rounded-md p-4 flex flex-col gap-2.5" style={{ background: 'var(--bg-surface, rgba(255,255,255,0.03))', border: '1px solid var(--border-primary)' }}>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-tertiary w-28 shrink-0">Network</span>
            <span className="text-sm">{settings.chainId}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-tertiary w-28 shrink-0">App Identity</span>
            <span className="text-sm font-mono">{settings.appIdentity}</span>
          </div>
          {settings.name && (
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-text-tertiary w-28 shrink-0">Provider Name</span>
              <span className="text-sm">{settings.name}</span>
            </div>
          )}
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-tertiary w-28 shrink-0">Node API</span>
            <span className="text-sm font-mono truncate">{settings.pocketApiUrl}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-tertiary w-28 shrink-0">Node RPC</span>
            <span className="text-sm font-mono truncate">{settings.pocketRpcUrl}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-tertiary w-28 shrink-0">Indexer API</span>
            <span className="text-sm font-mono truncate">{settings.indexerApiUrl}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-text-tertiary w-28 shrink-0">Min Stake</span>
            <span className="text-sm">{settings.minimumStake?.toLocaleString()} uPOKT</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Regions', count: counts.regions },
          { label: 'Relay Miners', count: counts.relayMiners },
          { label: 'Services', count: counts.services },
          { label: 'Address Groups', count: counts.addressGroups },
          { label: 'Delegators', count: counts.delegators },
        ].map(({ label, count }) => (
          <div key={label} className="rounded-md p-3 text-center" style={{ background: 'var(--bg-surface, rgba(255,255,255,0.03))', border: '1px solid var(--border-primary)' }}>
            <p className="text-xl font-bold">{count ?? '—'}</p>
            <p className="text-xs text-text-tertiary mt-1">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export const Stepper: React.FC = () => {
  const [isLoadingSettings, setIsLoadingSettings] = React.useState(true);
  const [hasError, setHasError] = React.useState(false);
  const [settings, setSettings] = React.useState<ApplicationSettings>();

  const stepper = useStepper();

  const currentIndex = utils.getIndex(stepper.current.id);
  const updateSettingsFromDb = async () => {
    setHasError(false);
    setSettings(undefined);
    try {
      setIsLoadingSettings(true);
      const dbSettings = await GetApplicationSettings();
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
    <>
      <div className="flex flex-col p-4">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">System Bootstrap</h2>
          <nav aria-label="Bootstrap Steps" className="pb-4 mb-2" style={{ borderBottom: '1px solid var(--border-primary)' }}>
            <div className="flex items-center justify-center gap-5">
              {/* Previous step */}
              {currentIndex > 0 && (
                <>
                  <div className="flex items-center gap-2.5 opacity-80">
                    <div
                      className="flex size-8 shrink-0 items-center justify-center rounded-full"
                      style={{ background: 'rgba(72, 229, 194, 0.15)', border: '1px solid rgba(72, 229, 194, 0.35)' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M11.5 4L5.5 10L2.5 7" stroke="var(--pnf-mint, #48e5c2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <span className="text-sm hidden sm:inline">{stepper.all[currentIndex - 1].title}</span>
                  </div>
                  <div className="w-10 h-px" style={{ background: 'linear-gradient(90deg, rgba(72,229,194,0.3), var(--border-primary))' }} />
                </>
              )}

              {/* Current step */}
              <div className="flex items-center gap-3">
                <div
                  className="grid place-items-center size-9 shrink-0 rounded-full font-mono text-sm font-bold"
                  style={{
                    background: 'rgba(2, 90, 242, 0.15)',
                    border: '1.5px solid rgba(2, 90, 242, 0.4)',
                    color: 'var(--pnf-blue-light, #5ba3f5)',
                  }}
                >
                  {currentIndex + 1}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">{stepper.current.title}</span>
                  <span className="text-xs" style={{ color: 'var(--text-secondary, #999)' }}>
                    Step {currentIndex + 1} of {steps.length}
                  </span>
                </div>
              </div>

              {/* Next step */}
              {currentIndex < steps.length - 1 && (
                <>
                  <div className="w-10 h-px" style={{ background: 'linear-gradient(90deg, var(--border-primary), transparent)' }} />
                  <div className="flex items-center gap-2.5 opacity-80">
                    <div
                      className="grid place-items-center size-8 shrink-0 rounded-full font-mono text-sm"
                      style={{ border: '1px solid rgba(255,255,255,0.2)', color: 'var(--text-primary)' }}
                    >
                      {currentIndex + 2}
                    </div>
                    <span className="text-sm hidden sm:inline">{stepper.all[currentIndex + 1].title}</span>
                  </div>
                </>
              )}
            </div>
          </nav>
        </div>

        <div className="space-y-5">
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
            blockchain: () => (
              <ConfigureBlockChain
                defaultValues={settings!}
                goNext={stepper.next}
              />
            ),
            "identity-settings": () => (
              <ConfigureAppSettings
                defaultValues={settings!}
                goNext={stepper.next}
                goBack={stepper.prev}
              />
            ),
            "regions": () => (
                <ConfigureRegions goNext={stepper.next} goBack={stepper.prev} />
            ),
            "relay-miners": () => (
              <ConfigureRelayMiners goNext={stepper.next} goBack={stepper.prev} />
            ),
            services: () => (
              <ConfigureServices goNext={stepper.next} goBack={stepper.prev} />
            ),
            "address-groups": () => (
              <ConfigureAddressGroup
                goNext={stepper.next}
                goBack={stepper.prev}
              />
            ),
            delegators: () => (
              <ConfigureDelegators
                goNext={stepper.next}
                goBack={stepper.prev}
              />
            ),
            "complete-bootstrap": () => (
              <BootstrapSummary settings={settings} />
            ),
          })}
        </div>

        {stepper.current.id === "complete-bootstrap" && (
          <div className="flex justify-end gap-4">
            <Button variant="outline" onClick={stepper.prev}>Back</Button>
            <Button onClick={completeSetup}>Complete</Button>
          </div>
        )}
      </div>
    </>
  );
};
