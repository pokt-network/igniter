"use client";

import { usePathname } from "next/navigation";
import { isInternalPath } from "@igniter/commons/utils";
import { SidebarTrigger } from "@igniter/ui/components/sidebar";

// The sidebar toggle only makes sense where the sidebar exists: the
// authenticated app/admin areas. On the portal (landing) and auth pages there
// is no rail, so the trigger is hidden — same gate as Sidebar.tsx via the
// shared isInternalPath helper.
export default function SidebarTriggerGate() {
  const pathname = usePathname();
  if (!isInternalPath(pathname)) return null;

  return <SidebarTrigger />;
}