"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { getApplicationSettings } from "@/actions/ApplicationSettings";
import {ApplicationSettings} from "@igniter/db/middleman/schema";
import {getLogger} from "@igniter/logger";

const log = getLogger(['middleman', 'application-settings-context'])

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
      try {
        const settings = await getApplicationSettings();
        setApplicationSettings(settings);
      } catch (error) {
        log.error("failed to load application settings", { error });
      }
    })();
  }, []);

  return (
    <ApplicationSettingsContext.Provider value={applicationSettings}>
      {children}
    </ApplicationSettingsContext.Provider>
  );
};

export const useApplicationSettings = () =>
  useContext(ApplicationSettingsContext);
