"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { getApplicationSettings, type PublicApplicationSettings } from "@/actions/ApplicationSettings";
import {getLogger} from "@igniter/logger";
import { ChainIdProvider } from "@igniter/ui/context/explorer";
import { handleSessionExpired } from '@/app/context/sessionExpiredSignOut';

const log = getLogger(['middleman', 'application-settings-context'])

const ApplicationSettingsContext = createContext<PublicApplicationSettings | undefined>(undefined);

export const ApplicationSettingsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [applicationSettings, setApplicationSettings] =
    useState<PublicApplicationSettings | undefined>();

  useEffect(() => {
    (async () => {
      try {
        const settings = await getApplicationSettings();
        setApplicationSettings(settings);
      } catch (error) {
        if (handleSessionExpired(error)) return;
        log.error("failed to load application settings", { error });
      }
    })();
  }, []);

  return (
    <ApplicationSettingsContext.Provider value={applicationSettings}>
      <ChainIdProvider chainId={applicationSettings?.chainId}>
        {children}
      </ChainIdProvider>
    </ApplicationSettingsContext.Provider>
  );
};

export const useApplicationSettings = () =>
  useContext(ApplicationSettingsContext);
