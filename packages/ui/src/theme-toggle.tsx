"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="flex items-center gap-2.5 bg-bg-surface border border-border-primary rounded-full px-4 py-1.5 text-sm text-text-secondary hover:border-accent hover:text-text-primary transition-all cursor-pointer"
      aria-label="Toggle theme"
    >
      <span className="w-2.5 h-2.5 rounded-full bg-accent" />
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}
