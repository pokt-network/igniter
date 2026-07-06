[< Back to Provider documentation](../../../apps/provider/README.md)

# Notifications

## Overview

Notifications tell you when your workflows do something worth knowing about — suppliers staking or unstaking, funds or stake running low, a remediation run finishing, or a delegator sync landing changes. Provider records every such event to a history feed and, if you configure them, delivers the same events to external channels (Discord, Telegram, or email).

Provider notifications are **instance-wide**: channels belong to the operator, not to individual delegators, and fire on the workflows this instance runs. Nothing here is required to operate the Provider — it is monitoring you opt into.

Use this flow when you want supplier and remediation events pushed to a chat or inbox your team already watches.

---

## Prerequisites

- Operator (admin) access to the Provider instance
- For a **Discord** channel: a webhook URL for the target channel
- For a **Telegram** channel: a bot token and the chat ID to deliver to
- For **Email** channels: the shared SMTP configuration filled in once (see Step 2) — every email channel sends through it

---

## Walkthrough

### Step 1: Open Notifications

From the admin navigation, open **Notifications**. This is the history of every notification your workflows have sent. Click **Manage Notifications** in the top right to configure delivery.

<!-- SCREENSHOT: Capture the /admin/notifications history page showing the events feed and the "Manage Notifications" button. -->
<!-- ![Screenshot: Provider notifications history](../screenshots/provider-notifications-history.png) -->

---

### Step 2: Configure SMTP (Email Only)

At the top of the Manage page is the **SMTP configuration** — a single shared mail relay for the whole instance. Expand it and enter your host, port, TLS/SSL setting, username, password, and from address, then save.

> Configure SMTP once. Every email channel sends through this shared relay, so you do not repeat these settings per channel. Discord and Telegram channels do not need it.

<!-- SCREENSHOT: Capture the shared SMTP configuration form on the Manage Notifications page. -->
<!-- ![Screenshot: Shared SMTP configuration](../screenshots/provider-notifications-smtp.png) -->

---

### Step 3: Add a Channel

Under **Notification Channels**, click **Add channel**. Give it a name, pick its **Type** (Discord, Telegram, or Email), and leave it enabled so it delivers once saved.

> If you pick **Email** before the shared SMTP configuration is saved, the form tells you SMTP is missing — configure it in Step 2 first.

---

### Step 4: Pick Events

Toggle which events this channel should receive. Each has a preview so you can see an example message before subscribing:

| Event | Fires when |
|-------|------------|
| **Suppliers Staked** | One or more suppliers transition to the Staked state |
| **Suppliers Unstaked** | One or more suppliers begin the unstaking process |
| **Supplier Funds Low** | A supplier's operational funds fall below the minimum threshold |
| **Supplier Stake Low** | A supplier's stake falls below the configured minimum |
| **Remediation Summary** | A remediation workflow run finishes, with a summary of results |
| **Delegators Synced** | The governance delegator sync completes with changes |

---

### Step 5: Enter Delivery Details

The fields depend on the channel type:

- **Discord** — the **Webhook URL** for the target channel.
- **Telegram** — the **Bot token** and the **Chat ID**.
- **Email** — recipient addresses (**To**, plus optional **Cc**/**Bcc**). Delivery uses the shared SMTP configuration from Step 2.

> Secrets — webhook URL and bot token — are write-only. When editing an existing channel they display blank; leave them blank to keep the stored value, or type a new one to replace it.

<!-- SCREENSHOT: Capture the Add channel dialog on the configure step with events and delivery fields visible. -->
<!-- ![Screenshot: Add provider channel](../screenshots/provider-notifications-add-channel.png) -->

---

### Step 6: Send a Test

Click **Next**. Provider sends a test message to the channel and asks you to confirm you received it. A channel cannot be saved until a test succeeds — if it fails, the error is shown so you can fix the details and retry.

<!-- SCREENSHOT: Capture the verify step confirming a test message was sent. -->
<!-- ![Screenshot: Provider channel test](../screenshots/provider-notifications-test.png) -->

---

### Step 7: Save

Once the test succeeds, save the channel. It now delivers every subscribed event this instance produces. Use **Back to History** to return to the feed and watch events as they arrive.

<!-- SCREENSHOT: Capture the channel list showing a saved, enabled channel. -->
<!-- ![Screenshot: Saved provider channel](../screenshots/provider-notifications-channel-saved.png) -->

---

## Editing and Removing Channels

Each channel in the list can be edited or deleted. Editing reopens the two-step form and re-requires a successful test before saving. Deleting a channel stops delivery to it immediately; the history feed is unaffected. Updating the shared SMTP configuration affects all email channels at once.

---

**See also:** [Relay Miner Setup](./relay-miner-setup.md) · [Onboard a Delegator](./onboard-delegator.md) · [Notifications reference](../../reference/provider/notifications.md) · [Delegators](../../reference/provider/delegators.md)
