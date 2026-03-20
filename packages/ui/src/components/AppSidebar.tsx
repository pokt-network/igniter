import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
} from "./sidebar";

import { ComponentType } from "react";

export interface AppSidebarRoute {
  title: string;
  url: string;
  icon: ComponentType;
}

export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  MainRoutes: React.ReactNode;
  FooterRoutes: React.ReactNode;
}

export default function AppSidebar({
  MainRoutes,
  FooterRoutes,
  ...sidebarProps
}: Readonly<AppSidebarProps>) {
  return (
    <Sidebar
      className="top-(--header-height) !h-[calc(100svh-var(--header-height))]"
      {...sidebarProps}
    >
      <SidebarHeader></SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{MainRoutes}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{FooterRoutes}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarFooter>
    </Sidebar>
  );
}
