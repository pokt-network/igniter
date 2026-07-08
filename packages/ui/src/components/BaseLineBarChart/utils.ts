import type { ChartOptions } from 'chart.js'
import {
  type Duration,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  addMinutes,
  add,
  differenceInDays,
  differenceInHours,
  isAfter,
  compareAsc,
} from 'date-fns'
import { getLogger } from '@igniter/logger'

const log = getLogger(['ui', 'base-line-bar-chart'])

export type UnitTimeGroup = 'hour' | 'day' | 'week' | 'month' | 'year';
export interface Point {
  point: string
  start_date: string
  end_date?: string
  block_time?: string
}

export const getUtcEndOfDay = (date: Date | string) => {
  if (typeof date === 'string') {
    date = getDateFromIsoString(date);
  }

  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    23,
    59,
    59,
    999
  ));
};

export function getUtcStartOfDay(date: Date | string) {
  if (typeof date === 'string') {
    date = getDateFromIsoString(date);
  }

  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0
  ));
}

export const getUtcEndOfHour = (date: Date | string) => {
  if (typeof date === 'string') {
    date = getDateFromIsoString(date);
  }

  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    59,
    59,
    999
  ));
}

export const getUtcStartOfHour = (date: Date | string) => {
  if (typeof date === 'string') {
    date = getDateFromIsoString(date);
  }

  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0,
    0,
    0
  ));
}

export function addHoursToUtc(date: Date | string, hours: number) {
  if (typeof date === 'string') {
    date = getDateFromIsoString(date);
  }

  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

export function addDaysToUtc(date: Date | string, days: number) {
  if (typeof date === 'string') {
    date = getDateFromIsoString(date);
  }

  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

export function addMinutesToUtc(date: Date | string, minutes: number) {
  if (typeof date === 'string') {
    date = getDateFromIsoString(date);
  }

  return new Date(date.getTime() + minutes * 60 * 1000)
}

export function normalizeIsoDate(dateStr: string): string {
  if (dateStr.length === 19) {
    return `${dateStr}.000Z`;
  }

  return dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`
}

export function getDateFromIsoString(date: string) {
  return new Date(normalizeIsoDate(date))
}

export const getFormatForUnit = (unitTime: UnitTimeGroup) => {
  switch (unitTime) {
    case 'hour': {
      return 'YYYY-MM-DD HH'
    }
    case 'week':
    case 'day': {
      return 'YYYY-MM-DD'
    }
    case 'month': {
      return 'YYYY-MM'
    }
    case 'year': {
      return 'YYYY'
    }
    default:
      throw new Error('unit time it is not supported')
  }
}

export const getStartAndEndDate = (
  start: string,
  end: string,
) => {
  const startDate = new Date(start)
  const endDate = new Date(end)

  if (startDate > endDate) {
    throw new Error('start date cannot be greater than end date')
  }

  return {
    startDate,
    endDate,
  }
}

export const getPointsBetweenDateRanges = (
  start: string,
  end: string,
  unitTime: UnitTimeGroup,
  interval = 1,
  includeExtreme = false,
  dateIsExclusive = false
) => {
  if (interval < 1) {
    interval = 1;
  }

  let startOfDateRange: Date;
  let endOfDateRange: Date;
  const points: Array<Point> = [];

  const format = getFormatForUnit(unitTime); // Adjust as needed

  const {startDate, endDate} = getStartAndEndDate(start, end);

  if (unitTime === 'week') {
    let startOfDate = startDate;
    let endOfDate = endDate;

    if (!dateIsExclusive) {
      startOfDate = includeExtreme ? startOfWeek(startDate, { weekStartsOn: 1 }) : startOfDay(startDate);
      endOfDate = includeExtreme ? endOfWeek(endDate, { weekStartsOn: 1 }) : endOfDay(endDate);
    }

    startOfDateRange = startOfDate;
    let firstDayOfWeek = startOfDate;
    let daysBetweenRange = differenceInDays(addMinutes(endOfDate, 1), startOfDate);

    while (daysBetweenRange > 0) {
      let endOfWeekDate = endOfWeek(add(firstDayOfWeek, { weeks: interval - 1 }), { weekStartsOn: 1 });
      if (isAfter(endOfWeekDate, endOfDate)) {
        endOfWeekDate = endOfDate;
      }

      daysBetweenRange -= differenceInDays(addMinutes(endOfWeekDate, 1), firstDayOfWeek);

      points.push({
        point: firstDayOfWeek.toISOString(),
        start_date: firstDayOfWeek.toISOString(),
        end_date: endOfWeekDate.toISOString(),
      });

      firstDayOfWeek = add(firstDayOfWeek, { weeks: interval });
    }
    endOfDateRange = endOfDate;
  } else {
    const durationKey = getDurationKey(unitTime)

    let startOfDate = startDate;
    let endOfDate = endDate;

    if (!dateIsExclusive) {
      startOfDate = unitTime === 'hour' ? getUtcStartOfHour(startDate) : getUtcStartOfDay(startDate);
      endOfDate = unitTime === 'hour' ? getUtcEndOfHour(endDate) : getUtcEndOfDay(endDate);
    }

    startOfDateRange = new Date(startOfDate);
    endOfDateRange = new Date(endOfDate);

    let unitsBetweenRange = unitTime === 'hour'
      ? differenceInHours(addMinutesToUtc(endOfDate, 1), startOfDate)
      : differenceInDays(addMinutesToUtc(endOfDate, 1), startOfDate);

    let firstUnitOfPoint = new Date(startOfDate);

    while (unitsBetweenRange > 0) {
      let lastUnitOfPoint = unitTime === 'hour' ? getUtcEndOfHour(firstUnitOfPoint) : getUtcEndOfDay(firstUnitOfPoint);

      if (isAfter(lastUnitOfPoint, endOfDate)) {
        lastUnitOfPoint = new Date(endOfDate);
      }

      unitsBetweenRange -= unitTime === 'hour'
        ? differenceInHours(addMinutesToUtc(lastUnitOfPoint, 1), firstUnitOfPoint)
        : differenceInDays(addMinutesToUtc(lastUnitOfPoint, 1), firstUnitOfPoint);

      points.push({
        point: firstUnitOfPoint.toISOString(),
        start_date: firstUnitOfPoint.toISOString(),
        end_date: lastUnitOfPoint.toISOString(),
      });

      firstUnitOfPoint = add(firstUnitOfPoint, { [durationKey]: interval });
    }
  }

  return {
    point_format: format,
    startOfDateRange: startOfDateRange.toISOString(),
    endOfDateRange: endOfDateRange.toISOString(),
    points,
  };
};

export function passingResultsToPoints<T extends Point, U extends Point>(
  points: T[],
  results: U[],
  defaultPointData: Partial<U>,
  getDataToPassToPoint: (point: U, result: U) => Partial<U> | void,
  isByBlock = false
) {
  const newPoints: U[] = []
  let resultItems = 0

  for (const point of points) {
    let hasAdded = false

    let record: Partial<U> = {
      ...defaultPointData,
      ...point,
    }

    for (const result of results) {
      const { start_date: startDateOfResult, block_time: blockTimeOfResult } = result

      const start = isByBlock ? blockTimeOfResult : startDateOfResult

      if (compareAsc(start!, point.end_date!) > 0) {
        break
      }

      const dataToPassToPoint = getDataToPassToPoint(record as U, result)

      if (dataToPassToPoint) {
        record = {
          ...record,
          ...dataToPassToPoint,
        }
      }

      hasAdded = true
      resultItems++
    }

    if (hasAdded) {
      results = results.slice(resultItems)
      resultItems = 0
    }

    newPoints.push(record as U)
  }

  return newPoints
}

export function getDurationKey(unitTime: UnitTimeGroup): keyof Duration {
  switch (unitTime) {
    case 'day':
      return 'days'
    case 'hour':
      return 'hours'
    default:
      throw new Error('unit time it is not supported')
  }
}

export function formatDate(dateString: string, type: UnitTimeGroup, includeMonth = false): string {
  const date = new Date(dateString);

  if (type === "day") {
    if (includeMonth) {
      return date.toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        timeZone: "UTC",
      }).replace(',', '');
    }

    return date.getUTCDate().toString();
  }

  if (type === "hour") {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).replace(',', '');
  }

  throw new Error("Invalid type. Use 'day' or 'hour'.");
}

export function hashStringToColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 6) - hash);
  }

  // Extended blue range: 160-260 (turquoise to violet-blue)
  const hue = 160 + (Math.abs(hash * 37) % 100);

  // Wide saturation range for more variety
  const saturation = 45 + (Math.abs(hash * 23) % 55); // 45-100%

  // Extended lightness range including darker blues
  // Using different hash multipliers for better distribution
  const lightnessVariation = Math.abs(hash * 43) % 100;

  let lightness;
  if (lightnessVariation < 30) {
    // 30% chance: Dark blues (35-50% lightness)
    lightness = 35 + (Math.abs(hash * 17) % 16);
  } else if (lightnessVariation < 60) {
    // 30% chance: Medium blues (50-70% lightness)
    lightness = 50 + (Math.abs(hash * 29) % 21);
  } else {
    // 40% chance: Light blues (70-90% lightness)
    lightness = 70 + (Math.abs(hash * 31) % 21);
  }

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export interface ChartLoaderConfigProps {
  length: number
  xAxisKey: string
  yAxisKey: string
  stackLabels?: boolean
  unit?: 'day' | 'hour'
  timezone?: string
  dateFormat?: string
  customLabels?: Array<string>
  chartType?: 'bar' | 'line' | 'matrix'
  randomValues?: boolean
  constantValue?: number
  datasetProps?: object
  invertLoop?: boolean
  includeMonthToDate?: boolean
}


export const getChartLoaderConfig = (props: ChartLoaderConfigProps) => {
  const {
    length,
    xAxisKey,
    yAxisKey,
    unit = 'day',
    customLabels = [],
    chartType = 'bar',
    randomValues = false,
    constantValue = 100,
    datasetProps,
    invertLoop = true,
    includeMonthToDate = false,
  } = props
  const data = []
  const iterate = invertLoop ? length : 0
  const condition = (i: number) => (invertLoop ? i > 0 : i < length)
  for (let i = iterate; condition(i); invertLoop ? i-- : i++) {
    const dateLabel = formatDate((unit === 'day' ? addDaysToUtc : addHoursToUtc)(new Date(), -i + 1).toISOString(), unit, includeMonthToDate)
    if (chartType === 'matrix') {
      for (let j = 0; j < length; j++) {
        data.push({
          [xAxisKey]: customLabels.length > 0 ? customLabels[i] : `label-${i}`,
          [yAxisKey]: `${yAxisKey}-${j + 1}`,
        })
      }
    } else {
      data.push({
        [xAxisKey]: customLabels.length > 0 ? customLabels[i] : dateLabel,
        [yAxisKey]: randomValues ? Math.floor(Math.random() * 100) : constantValue,
      })
    }
  }
  return {
    labels: data.map((item) => item[xAxisKey]),
    datasets: [
      {
        type: chartType,
        data: data,
        borderWidth: 0,
        barPercentage: 1,
        order: 1,
        ...(chartType === 'line' && {
          tension: 0,
          borderWidth: 2,
          pointBackgroundColor: 'transparent',
        }),
        ...datasetProps,
      },
    ],
  }
}

interface CommonChartLoaderOptionsProps {
  isLight: boolean,
  chartType?: string,
  mainAnimationProps?: object,
  animations?: Array<object>
  from?: string
}

export const getCommonChartLoaderOptions = ({
                                              isLight,
                                              chartType = 'bar',
                                              mainAnimationProps,
                                              animations,
                                              from =  isLight
                                                ? '#F4F4F4CC'
                                                : 'rgba(51, 51, 51, 0.5)',
                                            }: CommonChartLoaderOptionsProps) => {
  const propKey = chartType === 'line' ? 'borderColor' : 'backgroundColor'
  return {
    animations: {
      [propKey]: {
        type: 'color',
        duration: 1000,
        easing: 'easeInOutBounce',
        from,
        to: 'rgba(201, 201, 201, 0.2)',
        loop: true,
        ...mainAnimationProps,
      },
      ...(chartType === 'matrix' && {
        borderColor: {
          type: 'color',
          duration: 1000,
          easing: 'easeInOutBounce',
          from: isLight ? '#FFF' : '#000',
          to: isLight ? '#DFDFDF' : '#333333',
          loop: true,
        },
        ...animations,
      }),
    },
    events: [], // disable hover & click events when it's loading
  } as ChartOptions<'bar'>
}

export type LineBarItem = {
  id: string
  point: string
  start_date: string
}

interface FillChartDataOptions<T extends LineBarItem> {
  data: Array<T>
  startDate: string
  endDate: string
  unitToFormatDate: UnitTimeGroup
  defaultProps?: Partial<T>
}

export function fillChartDataOld<T extends LineBarItem>({
                                                       data,
                                                       startDate,
                                                       endDate,
                                                       unitToFormatDate,
                                                       defaultProps,
                                                     }: FillChartDataOptions<T>): Array<T> {
  const {points} = getPointsBetweenDateRanges(startDate, endDate, unitToFormatDate, 1)

  return passingResultsToPoints(
    points,
    data,
    defaultProps || {},
    (point, item) => ({
      ...point,
      ...item,
      point: point.start_date
    })
  ) as unknown as Array<T>
}

export function fillChartData<T extends LineBarItem>({
  data,
  startDate,
  endDate,
  unitToFormatDate,
  defaultProps,
}: FillChartDataOptions<T>): Array<T> {
  // Early bailout: if no data or invalid dates, return empty or original data
  if (!data || data.length === 0) {
    return data || []
  }

  if (!startDate || !endDate) {
    return data
  }

  // Create a Map for O(1) lookup by point (date string)
  // This replaces the O(n×m) nested loop in passingResultsToPoints
  const dataMap = new Map<string, T>()
  for (const item of data) {
    // Normalize the point to ensure consistent matching
    const normalizedPoint = normalizeIsoDate(item.point)
    dataMap.set(normalizedPoint, item)
  }

  // Calculate date range efficiently
  const start = getDateFromIsoString(startDate)
  const end = getDateFromIsoString(endDate)

  // Determine increment function based on unit
  const incrementFn = unitToFormatDate === 'hour' ? addHoursToUtc : addDaysToUtc
  const startOfFn = unitToFormatDate === 'hour' ? getUtcStartOfHour : getUtcStartOfDay

  // Pre-calculate the number of points to avoid growing arrays
  const totalPoints = unitToFormatDate === 'hour'
    ? differenceInHours(end, start) + 1
    : differenceInDays(end, start) + 1

  // Validate totalPoints to prevent Safari RangeError
  if (!Number.isFinite(totalPoints) || totalPoints <= 0 || totalPoints > Number.MAX_SAFE_INTEGER) {
    log.error('Invalid totalPoints, returning original data', { totalPoints })
    return data
  }

  // Performance bailout: if dataset is very large (>100 points), consider skipping fill
  // This prevents multi-second blocking for extreme cases
  if (totalPoints > 100) {
    log.warn('Large dataset detected, consider skipping fillChartData for better performance', { totalPoints })
  }

  // Pre-allocate array for better memory performance
  const result: Array<T> = new Array(totalPoints)

  // Generate points iteratively - much faster than getPointsBetweenDateRanges
  let currentDate = startOfFn(start)
  let index = 0

  while (compareAsc(currentDate, end) <= 0 && index < totalPoints) {
    const pointIso = currentDate.toISOString()
    const normalizedPoint = normalizeIsoDate(pointIso)

    // O(1) lookup instead of O(n) inner loop
    const existingData = dataMap.get(normalizedPoint)

    if (existingData) {
      // Use existing data directly (avoid spreading if possible)
      result[index] = existingData
    } else {
      // Create missing point with default props
      // eslint-disable-next-line
      // @ts-ignore
      result[index] = {
        ...defaultProps,
        point: normalizedPoint,
        start_date: normalizedPoint,
      } as T
    }

    // Move to next time unit
    currentDate = incrementFn(currentDate, 1)
    index++
  }

  // Trim array if we allocated more than needed (edge case)
  return index < totalPoints ? result.slice(0, index) : result
}
