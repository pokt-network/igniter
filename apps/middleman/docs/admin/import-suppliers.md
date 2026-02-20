[< Back to Middleman documentation](../../README.md)

# Import Suppliers

## Overview

Import suppliers lets a delegator claim ownership of nodes that were staked with a provider before the delegator started using Igniter, or staked outside of Igniter entirely. This is **not** about uploading key files or creating new stakes — it is about recognizing existing on-chain suppliers in the Middleman database so they appear in your dashboard and node list.

The import uses a challenge-response pattern to verify address ownership: the provider generates a nonce, you sign it with your wallet to prove you own the address, and the provider returns the matching suppliers for that address.

> **Before you begin:** For this to work, the provider must already have your supplier keys loaded in their provider-side database. If the provider has not imported your keys yet, contact them first. See the [Provider key management documentation](../../../provider/docs/admin/key-management.md) for context on how providers manage supplier keys.

---

## Prerequisites

- A connected Pocket Network wallet (Sign-In with Pocket, SIWP)
- At least one provider configured and enabled in the Middleman admin (**Admin > Providers**)
- The provider must have your supplier keys already imported on their side

---

## Walkthrough

### Step 1: Select Owner Address

> This step only appears if you have multiple addresses connected to your wallet. If only one address is connected, Middleman skips directly to Step 2.

Choose the owner address whose suppliers you want to import. The challenge-response process will use this address to identify and verify your suppliers at the provider.

<!-- SCREENSHOT: Capture the "Import Suppliers" owner address step showing multiple connected addresses. -->
<!-- ![Screenshot: Import suppliers owner address step](../screenshots/import-suppliers-owner-address.png) -->

---

### Step 2: Select Provider

A list of all enabled and visible providers is shown, each with a health status badge:

| Badge | Meaning |
|-------|---------|
| **Healthy** | Provider is reachable and operating normally |
| **Unhealthy** | Provider is reachable but reporting issues |
| **Unknown** | Provider status has not been determined yet |
| **Unreachable** | Provider cannot be contacted |

Select the provider that has your staked suppliers.

> Only providers that are both **enabled** and **visible** in the admin configuration appear in this list. If you do not see your provider, check the admin settings under **Admin > Providers**.

The panel below the provider list reminds you: the provider needs to have your suppliers loaded in their provider-side database, and you will be asked to sign a message to verify ownership of your address.

<!-- SCREENSHOT: Capture the "Select Provider" step showing a list of providers with status badges and one selected. -->
<!-- ![Screenshot: Import suppliers select provider step](../screenshots/import-suppliers-select-provider.png) -->

---

### Step 3: Import Process

After selecting a provider, Middleman runs an automated three-stage import:

1. **Request Import** — Middleman sends an import request to the provider, which initiates an import attempt and returns a one-time nonce
2. **Sign Nonce** — You are prompted to sign the nonce with your connected wallet to prove ownership of the selected owner address
3. **Submit Import** — The signed nonce is submitted to the provider, which verifies the signature and returns the list of supplier nodes associated with your address

Progress indicators show the current status of each stage. If any stage fails, an error message appears with an option to retry.

> If the signature prompt is dismissed without signing, the import cannot complete. The nonce is tied to a single import attempt — you can retry from this step.

<!-- SCREENSHOT: Capture the import process step showing the three-stage progress indicators mid-import. -->
<!-- ![Screenshot: Import suppliers process step](../screenshots/import-suppliers-process.png) -->

---

### Step 4: Success

The success screen lists all imported suppliers with their addresses. Middleman redirects you to the nodes list (`/app/nodes`) where the imported suppliers now appear alongside any nodes you staked directly through Igniter.

Imported suppliers are tracked for rewards and status exactly the same as nodes staked through the standard staking flow.

<!-- SCREENSHOT: Capture the import success step showing the list of imported supplier addresses. -->
<!-- ![Screenshot: Import suppliers success step](../screenshots/import-suppliers-success.png) -->

---

## How It Works

The import attempt lifecycle tracks each stage:

- **Initiated** — Import request sent to provider
- **Signed** — Nonce signed by delegator wallet
- **Submitted** — Signed nonce delivered to provider
- **Completed** — Provider confirmed and returned supplier list
- **Failed / Cancelled** — Import did not complete

Each import attempt is associated with a specific owner address and provider combination. If you need to re-import (e.g., to pick up newly added suppliers), run the import flow again.

---

## Aborting an Import

At any step, click the **X** button in the header to open the abort confirmation dialog.

> If a provider has already been selected and the import process has started, any pending import attempts for that owner address and provider combination are cancelled when you abort. This cleans up the in-progress state on both the Middleman and provider side.

---

**See also:** [Staking](./staking.md) · [Unstaking](./unstaking.md) · [Overview](./overview.md) · [Transactions](./transactions.md)
