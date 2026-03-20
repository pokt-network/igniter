"use client";

import { useSidebar } from "@igniter/ui/components/sidebar";
import { useEffect } from "react";

export default function LandingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { setOpen, setOpenMobile } = useSidebar();

  useEffect(() => {
    setOpen(false);
    setOpenMobile(false);
  }, [setOpen, setOpenMobile]);

  return <>{children}</>;
}
