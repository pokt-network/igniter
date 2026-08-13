import {ComponentType} from "react";
import {PlaceholderLogo} from "@igniter/ui/assets";
import { PocketBrandLogo } from "../PocketBrandLogo";


export interface AppTopBarProps {
  logoIcon?: ComponentType;
  leading?: React.ReactNode;
  children?: React.ReactNode;
}

export async function AppTopBar({ logoIcon: LogoIcon, leading, children } : Readonly<AppTopBarProps>) {

  return (
    <header
      className={
        "px-3 lg:px-6 sticky z-[50] border-b border-border-primary top-0 flex flex-row items-center justify-between bg-bg-surface shrink-0"
      }
    >
      <div
        className={
          "h-(--header-height) w-full flex items-center justify-between"
        }
      >
        <div className="flex items-center gap-2">
          { leading }
          { LogoIcon ? <LogoIcon /> : <PocketBrandLogo /> }
        </div>
        <div className="w-full md:w-auto flex flex-row items-center gap-3 justify-end">
          {children}
        </div>
      </div>
    </header>
  );
}
