"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@igniter/ui/components/sidebar";

// The sidebar toggle only makes sense where the sidebar exists: the
// authenticated app/admin areas. On the portal (landing) and auth pages there
// is no rail, so the trigger is hidden — mirrors the gate in Sidebar.tsx.
export default function SidebarTriggerGate() {
  const pathname = usePathname();
  const isInternal =
    pathname.startsWith("/app") || pathname.startsWith("/admin");
  if (!isInternal) return null;

  return <SidebarTrigger />;
}