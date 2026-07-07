[< Back to Middleman documentation](../../../apps/middleman/README.md)

# Notifications

## Overview

Notifications keep you informed about what happens to *your* suppliers, transactions, and imports without watching the dashboard. Middleman records every relevant event to an in-app history feed, and — if you configure them — pushes the same events out to external channels (Discord, Telegram, or email).

Notifications are **per-wallet**: you only receive updates for suppliers and transactions owned by the wallet you signed in with. Setting up a channel for your wallet has no effect on anyone else's, and nothing here is required to stake — the in-app feed works out of the box and external channels are entirely optional.

Use this flow when you want stake outcomes, supplier changes, or import results delivered to a chat or inbox you already watch.

---

## Prerequisites

- A connected Pocket Network wallet (Sign-In with Pocket, SIWP)
- For a **Discord** channel: a webhook URL for the target channel
- For a **Telegram** channel: a bot token and the chat ID to deliver to
- For an **Email** channel: credentials for your own SMTP relay (host, port, username, password) and a from address — Igniter does not send mail on your behalf

---

## Walkthrough

### Step 1: Open Notifications

From the sidebar, open **Notifications**. This is your history feed — every supplier change, transaction outcome, and import result for your wallet is listed here, newest first. Click **Manage Notifications** in the top right to configure delivery.

<!-- SCREENSHOT: Capture the /app/notifications history page showing the feed and the "Manage Notifications" button. -->
<!-- ![Screenshot: Notifications history](../screenshots/notifications-history.png) -->

---

### Step 2: Choose Where Updates Appear

The **In-app notifications** toggle at the top of the Manage page controls whether events surface in the header while you use Middleman. It is on by default.

> Turning the in-app feed off does not stop delivery to your channels — the two are independent. Events are always recorded to the history feed regardless of this toggle.

<!-- SCREENSHOT: Capture the Manage Notifications page showing the in-app notifications toggle and the "Add channel" button. -->
<!-- ![Screenshot: Manage notifications](../screenshots/notifications-manage.png) -->

---

### Step 3: Add a Channel

Click **Add channel**. Give the channel a name, pick its **Type** (Discord, Telegram, or Email), and leave **Enabled** on so it delivers once saved.

> The channel type cannot be changed after creation. To switch from Discord to email, create a new channel and delete the old one.

---

### Step 4: Pick Events

Under **Events**, toggle which updates this channel should receive. All seven are on by default:

| Event | Fires when |
|-------|------------|
| **Service changed** | A service is added or removed on one of your suppliers |
| **Revenue share changed** | A supplier's revenue share changes on-chain |
| **Stake outcome** | A stake transaction succeeds or fails |
| **Unstake outcome** | An unstake transaction succeeds or fails |
| **Upstake outcome** | An upstake transaction succeeds or fails |
| **Operational funds** | An operational funding transaction settles |
| **Import result** | A supplier import completes or fails |

Each channel keeps its own set of toggles, so you can send transaction outcomes to one place and import results to another.

---

### Step 5: Enter Delivery Details

The fields below the event list depend on the channel type:

- **Discord** — the **Webhook URL** for the target channel.
- **Telegram** — the **Bot token** and the **Chat ID** to deliver to.
- **Email** — recipient addresses (**To**, plus optional **Cc**/**Bcc**) and your **SMTP server** settings: host, port, TLS/SSL, username, password, and the from address. Port 587 with TLS/SSL off is the STARTTLS default; use port 465 with TLS/SSL on for implicit TLS.

> Secrets — webhook URL, bot token, and SMTP password — are write-only. When you edit an existing channel they come back blank; leave a secret blank to keep the stored value, or type a new one to replace it.

<!-- SCREENSHOT: Capture the Add channel dialog on the configure step with the Type set to Email and the SMTP fields visible. -->
<!-- ![Screenshot: Add channel configure step](../screenshots/notifications-add-channel.png) -->

---

### Step 6: Send a Test

Click **Next**. Middleman immediately sends a test message to the channel and asks you to confirm you received it.

> You cannot save a channel until a test has been sent successfully. If the test fails, the error is shown — fix the details with **Back**, or **Resend** once the target is reachable.

<!-- SCREENSHOT: Capture the verify step showing the "Test message sent. Did you receive it?" confirmation. -->
<!-- ![Screenshot: Channel test step](../screenshots/notifications-test.png) -->

---

### Step 7: Save

Once the test succeeds, click **Create** (or **Save** when editing). The channel now delivers every subscribed event for your wallet. Return to the history feed with **Back to History** to watch events as they land.

<!-- SCREENSHOT: Capture the channel list on the Manage page showing a saved, enabled channel. -->
<!-- ![Screenshot: Saved channel](../screenshots/notifications-channel-saved.png) -->

---

## Editing and Removing Channels

On the Manage page, each channel in the list can be edited or deleted. Editing reopens the same two-step form and re-requires a successful test before saving. Deleting a channel stops all delivery to it immediately; your history feed is unaffected.

---

**See also:** [Staking](./staking.md) · [Import Suppliers](./import-suppliers.md) · [Notifications reference](../../reference/middleman/notifications.md) · [Transactions](../../reference/middleman/transactions.md)
