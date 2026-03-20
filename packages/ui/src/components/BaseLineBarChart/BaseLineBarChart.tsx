'use client'
import type { ChartData, TooltipItem } from 'chart.js'
import { Chart, ChartProps } from 'react-chartjs-2'
import {
  ChartLoaderConfigProps,
  formatDate,
  getChartLoaderConfig,
  getCommonChartLoaderOptions,
  hashStringToColor,
  LineBarItem,
  UnitTimeGroup,
} from './utils'
import { useTheme } from 'next-themes'
import merge from 'lodash/merge'
import { toCurrencyFormat } from '../../lib/utils'

const colors = {
  primary: 'var(--chart-line-1)',
  skeleton: 'var(--border-subtle)',
  secondary: 'var(--text-secondary)',
}

interface BaseLineBarChartProps<T extends LineBarItem> {
  chartType?: 'line' | 'bar'
  data: Record<string, Array<T>>
  yAxisKey: keyof T
  yAxisLabel: string
  colorById?: Record<string, string>
  getTooltipLabel?: (data: T) => string | Array<string> | undefined
  unitToFormatDate?: UnitTimeGroup
  isLoading?: boolean
  customOptions?: Partial<ChartProps>
  customDataLoaderProps?: Partial<ChartLoaderConfigProps>
  formatValueAxisY?: (value: string | number) => string
  displayColorsInTooltip?: boolean
}

export default function BaseLineBarChart<T extends LineBarItem>({
  data,
  colorById,
  chartType = 'line',
  yAxisKey,
  yAxisLabel,
  unitToFormatDate = 'day',
  getTooltipLabel,
  isLoading = false,
  customOptions,
  customDataLoaderProps,
  formatValueAxisY,
  displayColorsInTooltip = true,
}: BaseLineBarChartProps<T>) {
  const {theme} = useTheme()

  const dataEntries = Object.entries(data)

  const chartData = isLoading
    ? getChartLoaderConfig({
        length: 7,
        xAxisKey: 'point',
        yAxisKey: yAxisKey.toString(),
        chartType: chartType,
        randomValues: true,
        ...customDataLoaderProps,
      })
    : {
    labels: [],
    datasets: dataEntries.map(([id, items], index) => {
      const color = colorById?.[id] || hashStringToColor(id)

      const baseProps = {
        type: chartType,
        data: items,
        categoryPercentage: 0.5,
        borderWidth: 0,
        barPercentage: 1,
        backgroundColor: color,
        order: index + 1,
      }

      if (chartType === 'line') {
        return {
          ...baseProps,
          tension: 0.1,
          borderWidth: 3,
          pointRadius: 2,
          pointHoverRadius: 4,
          pointHoverBorderWidth: 3,
          borderColor: color,
        }
      }

      if (chartType === 'bar') {
        return {
          ...baseProps,
          barPercentage: 1,
        }
      }
    })
  }

  let options: object = {
    parsing: {
      xAxisKey: 'point',
      yAxisKey: yAxisKey,
    },
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
    },
    scales: {
      x: {
        ticks: {
          font: {
            size: 10,
            weight: '400',
            style: 'normal',
          },
          color: colors.secondary,
          callback: function(value: number) {
            if (isLoading && chartData.labels.length > 0) {
              return chartData.labels[value]
            }

            const point = dataEntries?.[0]?.[1]?.[value]?.point

            if (point) {
              return formatDate(point, unitToFormatDate)
            } else {
              return value
            }
          }
        },
        grid: {
          display: true,
          drawBorder: false,
          lineWidth: 2,
          color: colors.skeleton,
          borderColor: colors.skeleton,
          tickColor: 'transparent',
          tickLength: 6,
        },
      },
      y: {
        grace: chartType === 'bar' ? '40%' : '40%',
        title: {
          display: true,
          text: yAxisLabel,
          color: 'var(--text-secondary)',
          font: {
            weight: '600',
            size: 13,
          },
        },
        ticks: {
          font: {
            size: 10,
            weight: '400',
            style: 'normal',
          },
          color: colors.secondary,
          callback: function (value: number) {
            if (formatValueAxisY) {
              return formatValueAxisY(value)
            }
            return toCurrencyFormat(value)
          }
        },
        grid: {
          display: true,
          drawBorder: false,
          color: colors.skeleton,
          borderColor: colors.skeleton,
          lineWidth: 2,
          tickColor: 'transparent',
          tickLength: 6,
        },
        beginAtZero: true,
      }
    },
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        boxWidth: 12,
        boxHeight: 12,
        boxPadding: 10,
        display: false,
        font: {
          size: 10,
          weight: '400',
          style: 'normal',
        },
      },
      tooltip: {
        mode: chartType === 'bar' ? 'point' :'nearest',
        intersect: false,
        displayColors: displayColorsInTooltip,
        boxWidth: 8,
        boxHeight: 7,
        caretSize: 8,
        bodySpacing: 5,
        boxPadding: 10,
        clip: false,
        bodyFont: {
          weight: 'bold'
        },
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        titleColor: colors.primary,
        padding: 10,
        callbacks: {
          title: function(tooltipItems: Array<TooltipItem<'bar'>>) {
            return formatDate(tooltipItems.at(0)!.label, unitToFormatDate === 'day' ? 'day' : 'hour', unitToFormatDate === 'day')
          },
          label: function(context: TooltipItem<'bar'>) {
            const data = context.dataset.data[context.dataIndex] as unknown as T

            return getTooltipLabel ? getTooltipLabel(data) : context.label
          },
        }
      },
    },
  }

  if (isLoading) {
    options = merge(
      options,
      getCommonChartLoaderOptions({
        isLight: theme === 'light',
        chartType,
        from: colors.skeleton
      })
    )
  }

  if (customOptions) {
    options = merge(options, customOptions)
  }

  return (
    <Chart
      type={'bar'}
      data={chartData as unknown as ChartData}
      redraw={false}
      options={options}
    />
  )
}
