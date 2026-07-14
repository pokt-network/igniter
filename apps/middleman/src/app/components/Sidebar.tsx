"use client";

import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@igniter/ui/components/sidebar";
import Link from "next/link";
import { usePathname } from "next/navigation";
import OverviewDark from "@/app/assets/icons/dark/overview.svg";
import ActivityDark from "@/app/assets/icons/dark/activity.svg";
import NodesDark from "@/app/assets/icons/dark/nodes.svg";
import SettingsDark from "@/app/assets/icons/dark/settings.svg";
import ProvidersDark from "@/app/assets/icons/dark/providers.svg";
import AppSidebar from "@igniter/ui/components/AppSidebar"
export interface AppSidebarProps {}

const mainRoutes = [
  {
    title: "Overview",
    url: "/app/overview",
    icon: OverviewDark,
  },
  {
    title: "Providers",
    url: "/app/providers",
    icon: ProvidersDark,
  },
  {
    title: "Transactions",
    url: "/app/transactions",
    icon: ActivityDark,
  },
  {
    title: "Suppliers",
    url: "/app/suppliers",
    icon: NodesDark,
  },
  {
    title: "Notifications",
    url: "/app/notifications",
    icon: ActivityDark,
  },
];

const adminRoutes = [
  {
    title: "Overview",
    url: "/admin/overview",
    icon: OverviewDark,
  },
  {
    title: "Providers",
    url: "/admin/providers",
    icon: ProvidersDark,
  },
  {
    title: "Suppliers",
    url: "/admin/suppliers",
    icon: NodesDark,
  },
  {
    title: "Transactions",
    url: "/admin/transactions",
    icon: ActivityDark,
  },
  {
    title: "Workflows",
    url: "/admin/workflows",
    icon: ActivityDark,
  },
  {
    title: "Settings",
    url: "/admin/settings",
    icon: SettingsDark,
  }
];

export const dynamic = "force-dynamic";

export default function Sidebar({}: Readonly<AppSidebarProps>) {
  const pathname = usePathname();

  // Sidebar chrome belongs only to the authenticated app/admin areas. On the
  // portal (landing) and auth pages the whole rail is hidden — returning null
  // drops both the fixed rail and its layout spacer so content is full width.
  const isInternal =
    pathname.startsWith("/app") || pathname.startsWith("/admin");
  if (!isInternal) return null;

  const routes = pathname.startsWith("/admin") ? adminRoutes : mainRoutes;

  const MainRoutesMenu = routes.map((route) => (
    <SidebarMenuItem
      key={route.title}
      className={
        pathname.startsWith(route.url)
          ? "bg-sidebar-active-bg rounded-lg font-medium text-sidebar-active-text"
          : "text-text-secondary"
      }
    >
      <SidebarMenuButton asChild tooltip={route.title}>
        <Link href={route.url}>
          <route.icon />
          <span>{route.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  ));

  return (
    <AppSidebar MainRoutes={MainRoutesMenu} FooterRoutes={[]} />
  );
}
