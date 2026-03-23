"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { PocketLogoWhite, PocketLogoBlack } from "@igniter/ui/assets";

export interface PocketBrandLogoProps {
  href?: string;
}

export function PocketBrandLogo({ href = "/" }: Readonly<PocketBrandLogoProps>) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <Link href={href} className="h-[26px] flex items-center" />;

  const Logo = resolvedTheme === "dark" ? PocketLogoWhite : PocketLogoBlack;

  return (
    <Link href={href} className="h-[26px] flex items-center">
      <Logo className="h-[26px]" alt="Pocket Network" />
    </Link>
  );
}
