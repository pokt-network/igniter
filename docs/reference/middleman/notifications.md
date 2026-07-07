[< Back to Middleman documentation](../../../apps/middleman/README.md)

# Notifications

Notifications record what happens to the suppliers, transactions, and imports owned by the connected wallet, and optionally deliver those events to external channels. Everything is **per-wallet** — each signed-in wallet has its own channels, event history, and preferences, isolated from every other user of the same Middleman instance.

The in-app history feed works with no configuration. External delivery is opt-in, one channel at a time.

<!-- SCREENSHOT: Capture the /app/notifications history page and the /app/notifications/manage page side by side. -->
<!-- ![Screenshot: Notifications pages](../screenshots/notifications-overview.png) -->

---

## Pages

| Page | Path | Purpose |
|------|------|---------|
| History | `/app/notifications` | Chronological feed of every recorded event for your wallet |
| Manage | `/app/notifications/manage` | In-app feed toggle and channel configuration |

The header also surfaces new events as toasts while you browse, when the in-app feed is enabled.

---

## Event Types

Every event is recorded to your history feed and delivered to any enabled channel subscribed to that type.

| Event | Key | Fires when |
|-------|-----|------------|
| Service changed | `service_change` | A service is added or removed on one of your suppliers |
| Revenue share changed | `revshare_change` | A supplier's revenue share changes on-chain |
| Stake outcome | `stake` | A stake transaction succeeds or fails |
| Unstake outcome | `unstake` | An unstake transaction succeeds or fails |
| Upstake outcome | `upstake` | An upstake transaction succeeds or fails |
| Operational funds | `operational_funds` | An operational funding transaction settles |
| Import result | `import_result` | A supplier import completes or fails |

Events are addressed by owner: transaction outcomes go to the wallet that created the transaction, supplier changes to the wallet that owns the supplier, and import results to the wallet that ran the import.

---

## Channel Types

| Type | Delivery | Required fields |
|------|----------|-----------------|
| **Discord** | Webhook POST to a channel | Webhook URL |
| **Telegram** | Bot message to a chat | Bot token, Chat ID |
| **Email** | SMTP send via your own relay | Recipients (To, optional Cc/Bcc) and SMTP host, port, TLS/SSL, username, password, from address, optional from name |

Each email channel carries its **own** SMTP settings — you own the relay and its uptime, not Igniter. Port 587 with TLS/SSL off selects STARTTLS; port 465 with TLS/SSL on selects implicit TLS.

---

## Channel Fields

| Field | Description |
|-------|-------------|
| **Name** | Display label for the channel |
| **Type** | Discord, Telegram, or Email — fixed after creation |
| **Enabled** | When off, the channel is kept but delivers nothing |
| **Events** | Per-channel toggles for the seven event types (all on by default) |
| **Delivery details** | Type-specific fields (webhook / bot token + chat ID / recipients + SMTP) |

Secret fields (webhook URL, bot token, SMTP password) are **write-only**: they are never returned to the UI, display blank when editing, and a blank value on save keeps the stored secret.

---

## Testing and Saving

Adding or editing a channel is a two-step flow: **configure**, then **verify**. On **Next**, a test message is sent to the channel; the channel cannot be saved until a test succeeds. This matches the Provider notification flow and guarantees every saved channel is reachable at least once.

---

## In-App Feed

| Preference | Default | Effect |
|------------|---------|--------|
| In-app notifications | On | Show new events as header toasts while using Middleman |

The feed toggle is independent of channel delivery — turning it off silences the header but does not stop external channels, and every event is written to the history feed either way.

---

## Security

Channel configuration (including secrets) is encrypted at rest with AES-256-CBC using the `NOTIFICATION_ENCRYPTION_KEY` environment variable and a random per-record IV. This key is distinct from Provider's `ENCRYPTION_KEY`; use a different value. Decryption fails closed — a missing or wrong key disables delivery rather than exposing plaintext. See the [Middleman README](../../../apps/middleman/README.md) for how to generate and set the key.

---

**See also:** [Notifications guide](../../guides/middleman/notifications.md) · [Transactions](./transactions.md) · [Overview](./overview.md) · [Import Suppliers](../../guides/middleman/import-suppliers.md)
