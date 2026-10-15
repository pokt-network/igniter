import { rewardsWindowsDocument } from '@igniter/graphql'
import { addHoursToUtc, getDateFromIsoString } from '../BaseLineBarChart/utils'
import { ExtractVariables } from '../../lib/graphql/types'

export function summaryVariables(
  addresses: Array<string>,
  supplierAddresses: Array<string>,
  dateStr: string,
): ExtractVariables<typeof rewardsWindowsDocument> {
  const date = getDateFromIsoString(dateStr)

  return {
    currentDate: date.toISOString(),
    last24Hours: addHoursToUtc(date, -24).toISOString(),
    last48Hours: addHoursToUtc(date, -48).toISOString(),
    addresses,
    supplierAddresses,
  }
}
