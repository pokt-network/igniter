[< Back to Middleman documentation](../../README.md)

# Staking

## Overview

Staking lets a delegator or owner allocate $POKT to supplier nodes through a selected provider. You choose how much to stake, pick a provider offer — which determines the provider, address group, relayed services, and revenue share terms — and sign the transaction with your connected wallet. The Middleman coordinates the full process: requesting supplier addresses from the provider, collecting your wallet signature, and scheduling the on-chain transaction.

Use this flow when you want to activate new staked nodes under your Pocket Network address.

---

## Prerequisites

- A connected Pocket Network wallet (Sign-In with Pocket, SIWP)
- At least one provider configured and enabled in the Middleman admin (**Admin > Providers**)
- Sufficient $POKT balance in your wallet to cover the stake amount, network fee, and operational funds

---

## Walkthrough

### Step 1: Select Owner Address

> This step only appears if you have multiple addresses connected to your wallet. If only one address is connected, Middleman skips directly to Step 2.

Choose which of your connected wallet addresses will be the stake owner. Each address is listed with its current $POKT balance. The address you select will be recorded as the owner of all supplier nodes created in this stake.

<!-- SCREENSHOT: Capture the "Select Owner Address" step showing multiple connected addresses with balances and checkboxes. -->
<!-- ![Screenshot: Select owner address step](../screenshots/stake-owner-address.png) -->

---

### Step 2: Pick Stake Amount

Use the slider or input field to enter the amount of $POKT to stake. The minimum stake amount is shown in the subtitle. The interface also displays the available balance for the selected owner address.

> If your balance is below the minimum stake, a warning message appears and you cannot continue until you add more tokens to your wallet.

<!-- SCREENSHOT: Capture the "Pick Stake Amount" step with the slider and amount display showing a valid stake amount. -->
<!-- ![Screenshot: Pick stake amount step](../screenshots/stake-pick-amount.png) -->

---

### Step 3: Pick Provider Offer

Browse the available provider offers for your stake amount. Each offer represents a provider's plan — including their address group configuration, the services relayed, and the revenue share split between you and the provider.

> The offer you select determines which provider operates your staked nodes, what services they relay, and the revenue share percentage. Compare offers before proceeding.

Each offer card shows:
- **Provider name** — the operator running the nodes
- **Plan name** — the specific address group configuration
- **Services** — the Pocket Network services relayed for this plan
- **Revenue share** — what percentage of rewards you retain versus what goes to the provider

Providers that are ineligible for your selected stake amount (e.g., no available slots) or currently unhealthy are shown in a collapsed "Not Available" section.

> **Deep linking:** The offer step can be pre-filled via URL parameters (`providerId`, `addressGroupId`, `linkedAccount`). If a valid pre-selection is provided, Middleman skips directly to the review step.

<!-- SCREENSHOT: Capture the "Pick Provider Offer" step showing one or more provider offer cards with an offer selected. -->
<!-- ![Screenshot: Pick provider offer step](../screenshots/stake-pick-offer.png) -->

---

### Step 4: Review and Sign

The review screen summarizes the full stake operation before you commit:

| Field | Description |
|-------|-------------|
| **Stake** | Total $POKT amount to be staked |
| **Service Fee** | Platform service fee percentage (if applicable) |
| **Network Fee** | Estimated on-chain transaction fee in $POKT |
| **Operational Funds** | Small $POKT amount sent per node to cover relay processing |
| **Total** | Sum of stake + network fee + operational funds |
| **Nodes** | Number of supplier nodes to be created |
| **Provider** | The selected provider name |
| **Plan** | The selected address group / plan name |
| **Owner Address** | The wallet address that will own the staked nodes |

The **Operations** section (expandable) shows the individual stake and operational fund transactions that will be signed.

When you click **Stake**, the process runs three stages:

1. **Request Suppliers** — Middleman contacts the provider to request supplier node addresses for this stake
2. **Sign Transaction** — Your wallet is prompted to sign the transaction bundle
3. **Schedule Transaction** — The signed transaction is submitted and scheduled for on-chain execution

If your wallet signature is rejected, an error message appears and you can retry without starting the process over.

<!-- SCREENSHOT: Capture the "Review" step showing the stake summary table and the three-stage process indicator. -->
<!-- ![Screenshot: Review and sign step](../screenshots/stake-review.png) -->

---

### Step 5: Success

The success screen confirms the stake has been scheduled and shows a summary of the operation including the stake amount, provider, plan, timestamp, and transaction status.

> Your stake is being processed. Avoid moving funds from your wallet for at least one hour to prevent funding errors while the transaction finalizes on-chain.

Click **Close** to return to the overview dashboard, where your new nodes will appear once the transaction confirms.

<!-- SCREENSHOT: Capture the "Scheduled!" success screen showing the stake summary with green gradient border. -->
<!-- ![Screenshot: Stake success step](../screenshots/stake-success.png) -->

---

## Aborting a Stake

At any step, click the **X** button in the header to open the abort confirmation dialog.

> If suppliers have already been requested (after Step 4 begins and the provider returns node addresses), aborting will release those supplier addresses back to the provider so they can be reassigned. The abort confirmation dialog handles this automatically.

If you close the browser tab instead of using the X button, supplier addresses that were already requested may remain reserved until the provider releases them on a timeout.

---

**See also:** [Unstaking](./unstaking.md) · [Import Suppliers](./import-suppliers.md) · [Overview](./overview.md) · [Transactions](./transactions.md)
