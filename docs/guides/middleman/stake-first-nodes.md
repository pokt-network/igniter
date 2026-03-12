[< Back to Middleman Guides](../../../README.md)

# How to stake your first nodes

> [!NOTE]
> **Before you start**
>
> - You have a Pocket Network wallet and can sign transactions with it
> - A provider is configured and enabled in the Middleman admin (**Admin > Providers**)
> - Your wallet has enough $POKT to cover the stake amount, network fee, and operational funds
>
> New to Middleman? Start with the [Middleman setup guide](../../../apps/middleman/README.md).

---

1. **Log in to Middleman.** Open `/app/` in your browser and click **Sign in with Pocket**. Connect your wallet and complete the Sign-In with Pocket (SIWP) flow to authenticate. You should land on the overview dashboard.

   ![Log in to Middleman](screenshots/step-01-login.png)
   <!-- Capture: The SIWP login screen at /app/ with the "Sign in with Pocket" button visible. -->

2. **Navigate to the staking page.** From the overview dashboard, click the **New Stake** button in the quick actions bar, or navigate directly to `/app/stake`. The staking wizard opens.

   ![Navigate to staking page](screenshots/step-02-navigate-stake.png)
   <!-- Capture: The overview dashboard with the "New Stake" quick action button highlighted in the header. -->

3. **Select your owner address.** If your wallet has multiple connected addresses, choose which one will own the staked nodes. Each address is shown with its current $POKT balance. If you only have one address, Middleman skips this step automatically.

   ![Select owner address](screenshots/step-03-owner-address.png)
   <!-- Capture: The "Select Owner Address" step showing multiple wallet addresses with balances and a radio button or checkbox for each. -->

4. **Configure your stake amount.** Use the slider or input field to enter how much $POKT you want to stake. The minimum stake amount is shown below the input. Watch the balance indicator — if your wallet balance falls below the minimum, you'll see a warning and cannot continue until you add more tokens.

   ![Configure stake amount](screenshots/step-04-stake-amount.png)
   <!-- Capture: The "Pick Stake Amount" step showing the slider, POKT amount input, and the available balance indicator below. -->

5. **Browse provider offers and select one.** Review the available provider offer cards. Each card shows the provider name, plan name, relayed services, and the revenue share split between you and the provider. Pick the offer that fits your needs and click **Select**.

   ![Browse and select a provider offer](screenshots/step-05-pick-offer.png)
   <!-- Capture: The "Pick Provider Offer" step showing several offer cards with one selected and highlighted. -->

6. **Review the cost breakdown.** The review screen shows every component of your stake before you commit: the stake amount, service fee (if applicable), network fee, operational funds per node, total cost, number of supplier nodes, provider name, plan name, and owner address. Take a moment to verify these match your expectations.

   ![Review cost breakdown](screenshots/step-06-review.png)
   <!-- Capture: The "Review" step showing the full cost breakdown table with all fields populated and the "Stake" button visible at the bottom. -->

7. **Confirm and sign the transaction.** Click **Stake**. Middleman sends a request to the provider to reserve supplier node addresses, then prompts your wallet to sign the transaction bundle. Approve the signature in your wallet app. You should see the process move through three stages: **Request Suppliers**, **Sign Transaction**, and **Schedule Transaction**.

   ![Sign the transaction](screenshots/step-07-sign.png)
   <!-- Capture: The three-stage progress indicator mid-flow, showing "Request Suppliers" complete, "Sign Transaction" in progress, and "Schedule Transaction" pending. -->

8. **Wait for the staking process to complete.** Once all three stages finish, a success screen appears confirming the stake has been scheduled. You should see a summary with the stake amount, provider, plan, and timestamp. Your stake is being processed — avoid moving funds from your wallet for at least one hour while the transaction finalises on-chain.

   ![Staking success screen](screenshots/step-08-success.png)
   <!-- Capture: The "Scheduled!" success screen with a green gradient border showing the stake summary including amount, provider, and timestamp. -->

9. **Verify your staked nodes appear on the overview.** Click **Close** to return to the overview dashboard. Once the on-chain transaction confirms, your new supplier nodes will appear in the staked tokens count and the rewards graph will begin tracking earnings.

   ![Verify nodes on overview](screenshots/step-09-verify-overview.png)
   <!-- Capture: The overview dashboard showing staked tokens count greater than zero and the rewards graph. -->

---

For the full staking reference including deep-link parameters and all cost fields, see the [Staking guide](./staking.md).
