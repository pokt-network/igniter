"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { GetPublicApplicationSettings, type PublicApplicationSettings } from "@/actions/ApplicationSettings";
import { ChainIdProvider } from "@igniter/ui/context/explorer";

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
      const settings = await GetPublicApplicationSettings();
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
