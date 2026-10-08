import { configuredServiceRewards } from './configuredServiceRewards'

const rewards = [
  { service_id: 'eth', gross_rewards: 100 },
  { service_id: 'base', gross_rewards: 50 },
  { service_id: 'solana', gross_rewards: 7 },
]

describe('configuredServiceRewards', () => {
  it('keeps only the services configured in the address group', () => {
    expect(configuredServiceRewards(rewards, ['eth', 'solana'])).toEqual([
      { service_id: 'eth', gross_rewards: 100 },
      { service_id: 'solana', gross_rewards: 7 },
    ])
  })

  it('matches ids regardless of case and surrounding whitespace', () => {
    expect(configuredServiceRewards(rewards, [' ETH ', 'Base'])).toEqual([
      { service_id: 'eth', gross_rewards: 100 },
      { service_id: 'base', gross_rewards: 50 },
    ])
  })

  it('returns nothing when no service is configured', () => {
    expect(configuredServiceRewards(rewards, [])).toEqual([])
  })
})
