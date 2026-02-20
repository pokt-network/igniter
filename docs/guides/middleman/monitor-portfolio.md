[< Back to Middleman Guides](../../../README.md)

# How to monitor your staking portfolio

> [!NOTE]
> **Before you start**
>
> - You are logged in to Middleman with your Pocket Network wallet
> - You have at least one staked node — if not, follow [How to stake your first nodes](./stake-first-nodes.md) first
>
> This guide covers the overview dashboard and transactions page. For the full reference, see the [Overview reference](../../../apps/middleman/docs/admin/overview.md) and the [Transactions reference](../../../apps/middleman/docs/admin/transactions.md).

---

1. **Navigate to the overview page.** After logging in, Middleman takes you directly to `/app/overview`. This is your staking portfolio home — come here any time you want a snapshot of your activity and earnings.

   ![Overview dashboard](screenshots/step-01-overview.png)
   <!-- Capture: The full /app/overview page showing the rewards summary cards and the rewards graph below. -->

2. **Read the rewards summary.** At the top of the overview you'll find three metric cards: **Staked Tokens** (total $POKT currently staked across all your nodes), **Rewards (24h)** (rewards earned in the last 24 hours), and **Rewards (48h)** (rewards earned in the last 48 hours). These numbers update as the Pocket Network indexer reports new data.

   ![Rewards summary cards](screenshots/step-02-rewards-summary.png)
   <!-- Capture: The three rewards summary cards zoomed in — Staked Tokens, Rewards (24h), and Rewards (48h) — with values visible. -->

3. **Check the rewards graph.** Below the summary cards is a line chart showing your rewards earned over time. Hover over any point on the chart to see the exact reward value for that moment. If no stakes exist yet, the graph shows a no-data message instead.

   ![Rewards graph](screenshots/step-03-rewards-graph.png)
   <!-- Capture: The rewards graph with a hover tooltip visible showing a specific data point's reward value. -->

4. **Use the quick action buttons.** The header of the overview page includes two shortcut buttons: **New Stake** opens the staking flow at `/app/stake`, and **Import Suppliers** opens the import suppliers flow at `/app/import-suppliers`. These let you start a new operation without leaving the overview.

   ![Quick action buttons](screenshots/step-04-quick-actions.png)
   <!-- Capture: The overview page header showing the "New Stake" and "Import Suppliers" buttons side by side. -->

5. **Navigate to the transactions page.** Click **Transactions** in the sidebar navigation, or go directly to `/app/transactions`. The transactions page shows a full history of all staking operations tied to your wallet.

   ![Navigate to transactions](screenshots/step-05-transactions-nav.png)
   <!-- Capture: The sidebar navigation with "Transactions" highlighted and the transactions page open in the background. -->

6. **Understand the transaction table.** Each row in the table represents a single transaction. The columns tell you what happened at a glance:
   - **Type** — Stake, Unstake, Upstake, or Operational Funds (with a rotated icon for unstake transactions; a warning icon if the transaction failed)
   - **Status** — Pending (awaiting on-chain confirmation), Success, Failure, or Not Executed
   - **Height** — the block number at which the transaction executed on-chain
   - **Created At** — when the transaction was submitted to Middleman
   - **Total POKT** — the $POKT amount involved

   ![Transaction table](screenshots/step-06-tx-table.png)
   <!-- Capture: The full transactions table showing several rows with different types (Stake, Unstake) and statuses (Pending, Success). -->

7. **Filter transactions by type or status.** Use the filter bar above the table to narrow results. You can filter by type (Stake, Upstake, Unstake) or by status (Success, Failure, Pending). Click **All Transactions** to clear filters and return to the full list.

   ![Filter transactions](screenshots/step-07-filter.png)
   <!-- Capture: The filter bar with one filter button active (e.g., "Pending" highlighted), showing the filtered transaction list below. -->

8. **View transaction details.** Click the arrow button in the **Actions** column of any row to open the detail panel. The panel shows the full transaction breakdown including: transaction ID, type, status, created date, individual operations, on-chain hash (once confirmed), estimated and consumed fees, provider name, and provider fee type and amount.

   ![Transaction detail panel](screenshots/step-08-tx-detail.png)
   <!-- Capture: The transaction detail side panel open showing all fields including operations list, provider name, and fee breakdown. -->

---

For the full overview dashboard reference including admin vs. user view differences, see the [Overview reference](../../../apps/middleman/docs/admin/overview.md).

For all transaction types, statuses, and columns, see the [Transactions reference](../../../apps/middleman/docs/admin/transactions.md).
