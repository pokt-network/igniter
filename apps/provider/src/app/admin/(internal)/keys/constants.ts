import {KeyState} from "@igniter/db/provider/enums";
import type {BadgeProps} from "@igniter/ui/components/badge";

export const KeyStateLabels: Record<KeyState, string> = {
  [KeyState.Imported]: 'Imported',
  [KeyState.Available]: 'Available',
  [KeyState.Delivered]: 'Delivered',
  [KeyState.Staking]: 'Staking',
  [KeyState.Staked]: 'Staked',
  [KeyState.StakeFailed]: 'Stake Failed',
  [KeyState.AttentionNeeded]: 'Attention Needed',
  [KeyState.RemediationFailed]: 'Remediation Failed',
  [KeyState.Unstaking]: 'Unstaking',
  [KeyState.Unstaked]: 'Unstaked',
  [KeyState.MissingStake]: 'Missing Stake',
}

type BadgeVariant = NonNullable<BadgeProps['variant']>

/**
 * Label used for the terminal "Retired" lifecycle status. A key is retired
 * once its `retiredAt` column is set (set-once on verified unstake); a retired
 * key is never reused for new stakes. "Retired" is NOT a KeyState — it is a
 * derived lifecycle status that takes precedence over the raw KeyState.
 */
export const RETIRED_LIFECYCLE_LABEL = 'Retired' as const

/**
 * The unified lifecycle status used by BOTH the status badge and the status
 * filter: either one of the KeyState labels, or the derived 'Retired' label.
 */
export type KeyLifecycleStatus =
  | (typeof KeyStateLabels)[KeyState]
  | typeof RETIRED_LIFECYCLE_LABEL

/**
 * Derives the single lifecycle status for a key.
 *
 * Precedence:
 *  - `retiredAt` set -> 'Retired' (HIGHEST precedence, regardless of `state`).
 *  - otherwise        -> the KeyState's label (KeyStateLabels[state]).
 *
 * This is the source of truth shared by the status badge and the status
 * filter so a retired key ALWAYS reads as "Retired" and is filterable as such.
 */
export function deriveKeyLifecycleStatus(key: {
  state: KeyState
  retiredAt?: Date | null
}): KeyLifecycleStatus {
  if (key.retiredAt != null) {
    return RETIRED_LIFECYCLE_LABEL
  }
  return KeyStateLabels[key.state] ?? key.state
}

/**
 * Badge variant for a derived lifecycle status. 'Retired' is slate/secondary
 * (terminal intent, consistent with the existing Retired/Unstaked styling);
 * every other status defers to the per-KeyState variant.
 */
export function keyLifecycleStatusBadgeVariant(
  status: KeyLifecycleStatus,
  state: KeyState,
): BadgeVariant {
  if (status === RETIRED_LIFECYCLE_LABEL) {
    return 'secondary'
  }
  return keyStateBadgeVariant(state)
}

/**
 * Maps a KeyState to the Badge variant used to render its lifecycle status.
 *
 * Color intent mirrors the hand-rolled pill in KeyDetail so the table badge and
 * the detail view agree:
 *  - Staked                                   -> success (green, healthy)
 *  - Staking / Delivered / Imported / Available -> info   (neutral, in-progress)
 *  - Unstaking                                -> warning (amber/gold, in-progress unstake)
 *  - Unstaked                                 -> secondary (slate, terminal)
 *  - StakeFailed / RemediationFailed /
 *    AttentionNeeded / MissingStake           -> destructive (red, needs attention)
 */
export function keyStateBadgeVariant(state: KeyState): BadgeVariant {
  switch (state) {
    case KeyState.Staked:
      return 'success'
    case KeyState.Staking:
    case KeyState.Delivered:
    case KeyState.Imported:
    case KeyState.Available:
      return 'info'
    case KeyState.Unstaking:
      return 'warning'
    case KeyState.Unstaked:
      return 'secondary'
    case KeyState.StakeFailed:
    case KeyState.RemediationFailed:
    case KeyState.AttentionNeeded:
    case KeyState.MissingStake:
      return 'destructive'
    default:
      return 'secondary'
  }
}
