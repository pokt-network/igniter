import {ComponentType} from "react";
import {PlaceholderLogo} from "@igniter/ui/assets";


export interface AppTopBarProps {
  logoIcon?: ComponentType;
  children?: React.ReactNode;
}

export async function AppTopBar({ logoIcon: LogoIcon, children } : Readonly<AppTopBarProps>) {

  return (
    <header
      className={
        "px-3 lg:px-6 sticky z-[50] border-b border-(--border) top-0 flex flex-row items-center justify-between bg-[color:var(--color-black-1)]"
      }
    >
      <div
        className={
          "h-(--header-height) w-full flex items-center justify-between"
        }
      >
        <div>
          { LogoIcon ? <LogoIcon /> : <PlaceholderLogo /> }
        </div>
        <div className="w-full md:w-auto flex flex-row items-center gap-10 justify-end">
          {children}
        </div>
      </div>
    </header>
  );
}
