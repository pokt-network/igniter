[< Back to Middleman documentation](../../../apps/middleman/README.md)

# Unstaking

## Overview

Unstaking removes your staked nodes from active service on the Pocket Network. Once you initiate an unstake, the selected nodes enter an unbonding period during which they stop generating rewards. After the unbonding period completes, the staked $POKT is returned to the owner address's wallet.

Use this flow when you want to exit one or more staked positions and reclaim your tokens.

---

## Prerequisites

- A connected Pocket Network wallet (Sign-In with Pocket, SIWP)
- At least one staked node associated with your owner address

---

## Walkthrough

### Step 1: Information

The information screen explains the unstaking timeline before you commit. It shows the estimated unbonding period — calculated from current network parameters (blocks per session, supplier unbonding period in sessions, and average block time). Expand the **Calculation Details** section to see the exact values used.

During the unbonding period, nodes will not generate rewards. After it completes, tokens are returned to the owner address.

Click **Continue** to proceed.

<!-- SCREENSHOT: Capture the "Unstake Nodes" information step showing the unbonding duration and the collapsed Calculation Details section. -->
<!-- ![Screenshot: Unstake information step](../screenshots/unstake-information.png) -->

---

### Step 2: Select Owner Address

> This step only appears if you have more than one connected address with staked nodes. If only one owner address has staked nodes, Middleman skips directly to Step 3.

Choose the owner address whose nodes you want to unstake. Only addresses that have at least one staked node are shown.

<!-- SCREENSHOT: Capture the "Select Owner Address" step (unstake flow) showing addresses with staked nodes. -->
<!-- ![Screenshot: Unstake select owner address step](../screenshots/unstake-owner-address.png) -->

---

### Step 3: Select Nodes

A list of all staked nodes for the selected owner address is displayed. Use the checkboxes to select one or more nodes to unstake. You can use the **Select All** toggle to select all visible nodes at once, and the search bar to filter by node address or provider name.

Each node row shows:
- **Node address** (truncated)
- **Provider name**
- **Stake amount** in $POKT

<!-- SCREENSHOT: Capture the "Select Nodes" step showing a list of staked nodes with checkboxes, a search bar, and the Select All toggle. -->
<!-- ![Screenshot: Unstake node selection step](../screenshots/unstake-select-nodes.png) -->

---

### Step 4: Review and Sign

The review screen summarizes the unstake operation:

| Field | Description |
|-------|-------------|
| **Unstake** | Total $POKT across all selected nodes |
| **Owner Address** | The wallet address that will receive the returned tokens |
| **Tokens to Receive** | $POKT to be returned after the unbonding period |
| **Nodes** | Number of nodes being unstaked |

Expand **Node Details** to see the individual node addresses, their provider, and stake amounts.

When you click **Unstake**, the process runs two stages:

1. **Sign Transaction** — Your wallet is prompted to sign the unstake transaction
2. **Schedule Transaction** — The signed transaction is submitted and scheduled for on-chain execution

If your wallet signature is rejected, an error message appears and you can retry.

<!-- SCREENSHOT: Capture the "Review" step (unstake flow) showing the summary table with owner address, tokens to receive, and the two-stage process indicator. -->
<!-- ![Screenshot: Unstake review and sign step](../screenshots/unstake-review.png) -->

---

### Step 5: Success

The success screen confirms the unstake has been scheduled. Your nodes will transition from **Staked** to **Unstaking** status in the nodes list. Once the unbonding period completes on-chain, the tokens will be returned to the owner address and node status will update to **Unstaked**.

Click **Close** to return to the overview dashboard.

<!-- SCREENSHOT: Capture the unstake success screen showing the node count and total stake amount. -->
<!-- ![Screenshot: Unstake success step](../screenshots/unstake-success.png) -->

---

## Aborting an Unstake

At any step, click the **X** button in the header to open the abort confirmation dialog. Unlike staking, aborting an unstake does not require releasing any reserved resources — no supplier addresses are held during the unstaking flow.

---

**See also:** [Staking](./staking.md) · [Import Suppliers](./import-suppliers.md) · [Overview](../../reference/middleman/overview.md) · [Transactions](../../reference/middleman/transactions.md)
