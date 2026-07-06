[< Back to Provider documentation](../../../apps/provider/README.md)

# Notifications

Notifications record the events your workflows produce — supplier state transitions, low-funds and low-stake warnings, remediation summaries, and delegator syncs — and optionally deliver them to external channels. Channels are **instance-wide**: they belong to the operator and fire on this Provider's own workflows, not on any individual delegator's activity.

The history feed records every event. External delivery is opt-in, one channel at a time.

<!-- SCREENSHOT: Capture the /admin/notifications history page and the /admin/notifications/manage page side by side. -->
<!-- ![Screenshot: Provider notifications pages](../screenshots/provider-notifications-overview.png) -->

---

## Pages

| Page | Path | Purpose |
|------|------|---------|
| History | `/admin/notifications` | Chronological feed of every notification sent by your workflows |
| Manage | `/admin/notifications/manage` | Shared SMTP configuration, channels, and event preferences |

---

## Event Types

Every event is recorded to the history feed and delivered to any enabled channel subscribed to that type.

| Event | Key | Fires when |
|-------|-----|------------|
| Suppliers Staked | `keys_staked` | One or more suppliers transition to the Staked state |
| Suppliers Unstaked | `keys_unstaked` | One or more suppliers begin the unstaking process |
| Supplier Funds Low | `supplier_funds_low` | A supplier's operational funds fall below the minimum threshold |
| Supplier Stake Low | `supplier_stake_low` | A supplier's stake falls below the configured minimum |
| Remediation Summary | `remediation_summary` | A remediation workflow run finishes, with a summary of results |
| Delegators Synced | `delegators_synced` | The governance delegator sync completes with changes |

Each channel subscribes to any subset of these. The Add/Edit form previews an example message per event.

---

## Channel Types

| Type | Delivery | Required fields |
|------|----------|-----------------|
| **Discord** | Webhook POST to a channel | Webhook URL |
| **Telegram** | Bot message to a chat | Bot token, Chat ID |
| **Email** | SMTP send via the shared relay | Recipients (To, optional Cc/Bcc) |

Unlike Middleman, email delivery uses a **single shared SMTP configuration** for the whole instance rather than per-channel SMTP. Email channels cannot be created until that shared configuration exists.

---

## Shared SMTP Configuration

Configured once on the Manage page and reused by every email channel.

| Field | Description | Default |
|-------|-------------|---------|
| **Host** | SMTP server hostname | — |
| **Port** | SMTP server port | 587 |
| **Secure** | Use implicit TLS (port 465). Off = STARTTLS (port 587) | On |
| **Username** | SMTP auth username | — |
| **Password** | SMTP auth password (write-only) | — |
| **From address** | Envelope/from address for sent mail | — |
| **From name** | Optional display name on sent mail | — |

Updating this configuration affects all email channels at once.

---

## Channel Fields

| Field | Description |
|-------|-------------|
| **Name** | Display label for the channel |
| **Type** | Discord, Telegram, or Email — fixed after creation |
| **Enabled** | When off, the channel is kept but delivers nothing |
| **Events** | Per-channel toggles for the six event types |
| **Delivery details** | Type-specific fields (webhook / bot token + chat ID / recipients) |

Secret fields (webhook URL, bot token, SMTP password) are **write-only**: they display blank when editing, and a blank value on save keeps the stored secret.

---

## Testing and Saving

Adding or editing a channel is a two-step flow: **configure**, then **verify**. On **Next**, a test message is sent using the current form values; the channel cannot be saved until a test succeeds — guaranteeing every saved channel is reachable at least once.

---

## Security

Channel configuration (including secrets) and the shared SMTP password are encrypted at rest using the `ENCRYPTION_KEY` and `ENCRYPTION_IV` environment variables. Decryption fails closed — a missing or wrong key disables delivery rather than exposing plaintext. See the [Provider README](../../../apps/provider/README.md) for how to set these.

---

**See also:** [Notifications guide](../../guides/provider/notifications.md) · [Delegators](./delegators.md) · [Relay Miners](./relay-miners.md) · [Key Management](./key-management.md)
