[< Back to Middleman Guides](../../../README.md)

# How to unstake and import suppliers

> [!NOTE]
> **Before you start**
>
> - You are logged in to Middleman with your Pocket Network wallet
>
> **For unstaking:** You have at least one staked node. Haven't staked yet? Start with [How to stake your first nodes](./stake-first-nodes.md).
>
> **For importing:** The provider must already have your supplier keys loaded in their provider-side database. If they haven't done this yet, contact your provider first.

---

This guide covers two related workflows: unstaking existing nodes to reclaim your $POKT, and importing suppliers that were staked outside of Igniter so they appear in your dashboard.

## Unstaking nodes

1. **Navigate to the unstaking page.** Go to `/app/unstake` or find the link in the sidebar navigation. Middleman opens the unstake wizard.

   ![Navigate to unstaking page](screenshots/step-01-navigate-unstake.png)
   <!-- Capture: The sidebar navigation with "Unstake" highlighted, showing the unstake wizard opening screen. -->

2. **Read the unbonding information.** The first screen explains the unstaking timeline. It shows the estimated unbonding period — the time your nodes will be inactive before the staked $POKT is returned to your wallet. Expand **Calculation Details** to see the exact network parameters (blocks per session, unbonding sessions, average block time) used to calculate the duration. Click **Continue** when ready.

   ![Unbonding information screen](screenshots/step-02-unbonding-info.png)
   <!-- Capture: The "Unstake Nodes" information step showing the estimated unbonding duration with the Calculation Details section collapsed. -->

3. **Select your owner address.** If you have multiple wallet addresses with staked nodes, choose which one you want to unstake from. Only addresses that have at least one staked node appear in this list. If you only have one eligible address, Middleman skips this step automatically.

   ![Select owner address](screenshots/step-03-owner-address.png)
   <!-- Capture: The "Select Owner Address" step (unstake flow) showing wallet addresses that have staked nodes with balances. -->

4. **Select the nodes to unstake.** A list of all staked nodes for the selected owner address appears. Check the boxes next to the nodes you want to unstake. Use the **Select All** toggle to select every visible node at once, or use the search bar to filter by node address or provider name.

   ![Select nodes to unstake](screenshots/step-04-select-nodes.png)
   <!-- Capture: The "Select Nodes" step showing a list of staked nodes with checkboxes, a search bar at the top, and some nodes checked. -->

5. **Review the unstaking summary.** The review screen confirms your selection: the total $POKT across all selected nodes, the owner address that will receive the tokens, the $POKT amount to be returned after unbonding, and the number of nodes being unstaked. Expand **Node Details** to see individual node addresses and stake amounts. When everything looks right, click **Unstake**.

   ![Review unstaking summary](screenshots/step-05-review-unstake.png)
   <!-- Capture: The review step (unstake flow) showing the summary table with total POKT, owner address, tokens to receive, and node count. -->

6. **Confirm and sign the transaction.** Your wallet will prompt you to sign the unstake transaction. Approve the signature. You should see two stages complete: **Sign Transaction** and **Schedule Transaction**.

   ![Sign unstake transaction](screenshots/step-06-sign-unstake.png)
   <!-- Capture: The two-stage progress indicator showing "Sign Transaction" and "Schedule Transaction" both completing successfully. -->

7. **Verify the unstaking transaction on the transactions page.** Click **Close** to return to the overview. Navigate to **Transactions** in the sidebar — your unstake transaction should appear with **Pending** status. Once the unbonding period completes on-chain, it will update to **Success** and the $POKT will return to your wallet.

   ![Verify unstake on transactions page](screenshots/step-07-verify-unstake.png)
   <!-- Capture: The transactions page showing the new unstake transaction with Pending status at the top of the list. -->

---

## Importing already-staked suppliers

Use this flow to claim suppliers that were staked with a provider before you started using Igniter — or staked outside of Igniter entirely. Importing makes those nodes visible in your dashboard and rewards tracking.

8. **Navigate to import suppliers.** Go to `/app/import-suppliers` or click **Import Suppliers** from the overview quick actions bar.

   ![Navigate to import suppliers](screenshots/step-08-navigate-import.png)
   <!-- Capture: The overview dashboard with the "Import Suppliers" quick action button highlighted in the header. -->

9. **Select your owner address.** If your wallet has multiple connected addresses, choose the one whose suppliers you want to import. If you only have one address, Middleman skips this step automatically.

   ![Select owner address for import](screenshots/step-09-owner-address-import.png)
   <!-- Capture: The "Import Suppliers" owner address step showing multiple connected addresses with a selection option for each. -->

10. **Select the provider.** A list of all enabled and visible providers appears, each with a health status badge (Healthy, Unhealthy, Unknown, or Unreachable). Select the provider that has your staked suppliers. If your provider isn't listed, check that they're enabled in **Admin > Providers**.

    ![Select provider](screenshots/step-10-select-provider.png)
    <!-- Capture: The "Select Provider" step showing provider cards with status badges — at least one Healthy provider visible and selected. -->

11. **Start the import process.** After selecting a provider, Middleman runs a three-stage automated import: **Request Import** (sends the import request to the provider and gets a one-time nonce back), **Sign Nonce** (your wallet is prompted to sign the nonce to prove ownership), and **Submit Import** (the signed nonce is submitted and the provider returns your matching supplier nodes).

    ![Import process stages](screenshots/step-11-import-process.png)
    <!-- Capture: The three-stage import progress indicator showing all three stages (Request Import, Sign Nonce, Submit Import) mid-flow or completed. -->

12. **Sign the nonce when prompted.** Your wallet will ask you to sign a message (the nonce). This signature proves you own the address without exposing your private key. Approve the signature in your wallet app. If you dismiss the prompt without signing, the import cannot complete — you can retry from this step.

    ![Sign nonce in wallet](screenshots/step-12-sign-nonce.png)
    <!-- Capture: A wallet signature prompt showing the nonce message to be signed, overlaid on the Middleman import process screen. -->

13. **Verify imported suppliers appear in your portfolio.** Once the import succeeds, the success screen lists all imported supplier addresses. Middleman then redirects you to the nodes list at `/app/nodes` where the imported suppliers now appear alongside any nodes you staked directly through Igniter. They are tracked for rewards and status exactly the same as directly-staked nodes.

    ![Verify imported suppliers](screenshots/step-13-verify-import.png)
    <!-- Capture: The /app/nodes page showing imported suppliers in the list with their addresses, provider name, and stake amounts visible. -->

---

For the full unstaking reference including unbonding duration formula, see the [Unstaking guide](./unstaking.md).

For the import suppliers reference including the challenge-response flow details, see the [Import Suppliers guide](./import-suppliers.md).
