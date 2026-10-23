"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { GetApplicationSettings } from "@/actions/ApplicationSettings";
import type {ApplicationSettings} from "@igniter/db/provider/schema";
import { ChainIdProvider } from "@igniter/ui/context/explorer";

const ApplicationSettingsContext = createContext<ApplicationSettings | undefined>(undefined);

export const ApplicationSettingsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [applicationSettings, setApplicationSettings] =
    useState<ApplicationSettings | undefined>();

  useEffect(() => {
    (async () => {
      const settings = await GetApplicationSettings();
      setApplicationSettings(settings);
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
