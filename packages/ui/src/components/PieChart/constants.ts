/**
 * Maximum number of slices shown in pie charts before grouping the rest as "Others".
 * Override via NEXT_PUBLIC_PIE_CHART_TOP_ITEMS env var.
 */
export const PIE_CHART_TOP_ITEMS: number =
  Number(process.env.NEXT_PUBLIC_PIE_CHART_TOP_ITEMS) || 5

/**
 * Pie chart color palette — designed for dark backgrounds (#0a0e13 / #1c2532).
 * Slots 0–4 match the app's --chart-1 through --chart-5 CSS variables.
 * Slots 5–6 are complementary extended hues.
 */
export const PIE_COLORS = [
  '#3b82f6', // blue-500
  '#14b8a6', // teal-500
  '#a855f7', // purple-500
  '#06b6d4', // cyan-500
  '#6366f1', // indigo-500
  '#f59e0b', // amber-500
  '#f43f5e', // rose-500
  '#10b981', // emerald-500
  '#0ea5e9', // sky-500
  '#d946ef', // fuchsia-500
  '#84cc16', // lime-500
  '#f97316', // orange-500
  '#8b5cf6', // violet-500
] as const

/** Color used for the "Others" slice — muted slate. */
export const PIE_OTHERS_COLOR = '#64748b' // slate-500
