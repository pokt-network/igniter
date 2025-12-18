import {KeyState} from "@igniter/db/provider/enums";

export const KeyStateLabels: Record<KeyState, string> = {
  [KeyState.Available]: 'Available',
  [KeyState.Delivered]: 'Delivered',
  [KeyState.Staking]: 'Staking',
  [KeyState.Staked]: 'Staked',
  [KeyState.StakingFailed]: 'Staking Failed',
  [KeyState.AttentionNeeded]: 'Attention Needed',
  [KeyState.RemediationFailed]: 'Remediation Failed',
  [KeyState.StakeFailed]: 'Stake Failed',
  [KeyState.Unstaking]: 'Unstaking',
  [KeyState.Unstaked]: 'Unstaked',
}
