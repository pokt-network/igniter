'use client'

import React, { useCallback, useMemo, useRef } from 'react'
import { Pie } from 'react-chartjs-2'
import type { Chart as ChartJS, ChartData, ChartOptions } from 'chart.js'
import { PIE_CHART_TOP_ITEMS, PIE_COLORS, PIE_OTHERS_COLOR } from './constants'

export interface PieChartItem {
  id: string
  value: number
  percent: number
}

export interface DistributionPieChartProps {
  data: PieChartItem[]
  label?: string
  topItems?: number
  className?: string
  /** 'right' (default) places the legend beside the chart; 'bottom' places it below in a multi-column grid */
  legendPosition?: 'right' | 'bottom'
  /** Pie chart canvas size in pixels (default 160) */
  size?: number
}

function groupItems(data: PieChartItem[], topItems: number): { items: PieChartItem[]; othersItems: PieChartItem[] } {
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, topItems)
  const rest = sorted.slice(topItems)

  if (rest.length > 0) {
    const othersValue = rest.reduce((sum, item) => sum + item.value, 0)
    const othersPercent = rest.reduce((sum, item) => sum + item.percent, 0)
    top.push({ id: 'Others', value: othersValue, percent: othersPercent })
  }

  return { items: top, othersItems: rest }
}

function getColors(items: PieChartItem[]): string[] {
  return items.map((item, i) =>
    item.id === 'Others'
      ? PIE_OTHERS_COLOR
      : (PIE_COLORS[i % PIE_COLORS.length] ?? PIE_OTHERS_COLOR)
  )
}

/** Convert a hex color to rgba with the given alpha */
function withAlpha(color: string, alpha: number): string {
  // Handle hex colors (#RRGGBB)
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return color
}

export default function DistributionPieChart({
  data,
  label,
  topItems = PIE_CHART_TOP_ITEMS,
  className,
  legendPosition = 'right',
  size = 160,
}: DistributionPieChartProps) {
  const chartRef = useRef<ChartJS<'pie'>>(null)
  const { items, othersItems } = useMemo(() => groupItems(data, topItems), [data, topItems])
  const colors = useMemo(() => getColors(items), [items])

  const chartOptions: ChartOptions<'pie'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          label: (context) => {
            const value = context.raw as number
            if (context.label === 'Others' && othersItems.length > 0) {
              return [
                ...othersItems.map(
                  (item) => `  ${item.id}: ${item.value.toLocaleString()}`
                ),
                `  Total: ${value.toLocaleString()}`,
              ]
            }
            return ` ${value.toLocaleString()}`
          },
        },
      },
    },
  }), [othersItems])

  const handleLegendClick = useCallback((index: number) => {
    const chart = chartRef.current
    if (!chart) return

    const meta = chart.getDatasetMeta(0)
    const element = meta.data[index]
    if (!element) return

    chart.tooltip?.setActiveElements(
      [{ datasetIndex: 0, index }],
      { x: element.x, y: element.y },
    )
    chart.update()
  }, [])

  const chartData: ChartData<'pie'> = useMemo(
    () => ({
      labels: items.map((item) => item.id),
      datasets: [
        {
          data: items.map((item) => item.value),
          backgroundColor: colors,
          borderColor: colors.map((c) => withAlpha(c, 0.4)),
          borderWidth: 2,
        },
      ],
    }),
    [items, colors],
  )

  if (!data.length) return null

  const legend = (
    <div
      className={
        legendPosition === 'bottom'
          ? 'grid grid-cols-2 gap-x-3 gap-y-1.5'
          : 'flex flex-col gap-1.5 min-w-0'
      }
    >
      {items.map((item, index) => (
        <div
          key={item.id}
          className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => handleLegendClick(index)}
        >
          <span
            className="inline-flex items-center justify-center rounded-sm px-1.5 py-0.5 text-[11px] font-bold text-white shrink-0 min-w-[42px]"
            style={{ backgroundColor: colors[index] }}
          >
            {item.percent.toFixed(1)}%
          </span>
          <span className="text-sm truncate text-foreground">
            {item.id}
          </span>
        </div>
      ))}
    </div>
  )

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`}>
      {label && (
        <p className="text-sm font-medium text-muted-foreground text-center">{label}</p>
      )}
      {legendPosition === 'bottom' ? (
        <>
          <div className="shrink-0 mx-auto" style={{ width: size, height: size }}>
            <Pie ref={chartRef} data={chartData} options={chartOptions} />
          </div>
          {legend}
        </>
      ) : (
        <div className="flex flex-row items-center gap-6">
          <div className="shrink-0" style={{ width: size, height: size }}>
            <Pie ref={chartRef} data={chartData} options={chartOptions} />
          </div>
          {legend}
        </div>
      )}
    </div>
  )
}
