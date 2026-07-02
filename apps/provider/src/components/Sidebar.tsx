"use client";

import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@igniter/ui/components/sidebar";
import { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import OverviewDark from "@/app/assets/icons/dark/overview.svg";
import ActivityDark from "@/app/assets/icons/dark/activity.svg";
import NodesDark from "@/app/assets/icons/dark/nodes.svg";
import SettingsDark from "@/app/assets/icons/dark/settings.svg";
import ProvidersDark from "@/app/assets/icons/dark/providers.svg";
import NotificationsDark from "@/app/assets/icons/dark/notifications.svg";
import AddressGroupsDark from "@/app/assets/icons/dark/address-groups.svg";
import RegionsDark from "@/app/assets/icons/dark/regions.svg";
import RelayMinersDark from "@/app/assets/icons/dark/relay-miners.svg";
import DelegatorsDark from "@/app/assets/icons/dark/delegators.svg";
import AppSidebar from "@igniter/ui/components/AppSidebar";

export interface AppSidebarRoute {
  title: string;
  url: string;
  icon: ComponentType;
}

export interface AppSidebarProps {}

const mainRoutes = [
  {
    title: "Overview",
    url: "/admin/overview",
    icon: OverviewDark,
  },
  {
    title: "Keys",
    url: "/admin/keys",
    icon: NodesDark,
  },
  {
    id: "transactions",
    title: "Transactions",
    url: "/admin/transactions",
    icon: ActivityDark,
  },
  {
    id: "groups",
    title: "Address Groups",
    url: "/admin/groups",
    icon: AddressGroupsDark,
  },
  {
    title: "Services",
    url: "/admin/services",
    icon: ProvidersDark,
  },
  {
    id: "regions",
    title: "Regions",
    url: "/admin/regions",
    icon: RegionsDark,
  },
  {
    id: "miners",
    title: "Relay Miners",
    url: "/admin/miners",
    icon: RelayMinersDark,
  },
  {
    title: "Delegators",
    url: "/admin/delegators",
    icon: DelegatorsDark,
  },
  {
    id: "workflows",
    title: "Workflows",
    url: "/admin/workflows",
    icon: ActivityDark,
  },
  {
    title: "Notifications",
    url: "/admin/notifications",
    icon: NotificationsDark,
  },
  {
    title: "Settings",
    url: "/admin/settings",
    icon: SettingsDark,
  },
];

export const dynamic = "force-dynamic";

export default function Sidebar({}: Readonly<AppSidebarProps>) {
  const pathname = usePathname();

  const MainRoutesMenu = mainRoutes.map((route) => (
    <SidebarMenuItem
      key={route.title}
      className={
        pathname.startsWith(route.url)
          ? "bg-sidebar-active-bg rounded-lg font-medium text-sidebar-active-text"
          : "text-text-secondary"
      }
    >
      <SidebarMenuButton asChild>
        <Link href={route.url}>
          <route.icon />
          <span>{route.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  ));

  return (
    <AppSidebar MainRoutes={MainRoutesMenu} FooterRoutes={null} />
  );
}
