import { getStartAndEndDateBasedOnTime } from '../../lib/dates'
import { ExtractVariables } from '../../lib/graphql/types'
import { rewardsByAddressAndTimeGroupByDateDocument } from '@igniter/graphql'

export function rewardsByAddressAndTimeGroupByDateVariables(
  addresses: Array<string>,
  supplierAddresses: Array<string>,
  dateStr: string,
  timeSelected: string
): ExtractVariables<typeof rewardsByAddressAndTimeGroupByDateDocument> {
  const {end, truncInterval, start} = getStartAndEndDateBasedOnTime(dateStr, timeSelected, true)

  return {
    addresses,
    supplierAddresses,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    truncInterval,
  }
}
