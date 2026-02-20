[< Back to Provider Guides](../../../README.md)

# How to onboard a new delegator

> **Before you start**
>
> - Your Provider instance must be deployed and fully bootstrapped. See the [Provider setup guide](../../../apps/provider/README.md) if you haven't done this yet.
> - You need to know whether you'll be importing delegators from the governance CDN or adding them manually. Most operators use the CDN — check that `DELEGATORS_CDN_URL` is set in your `.env` file if so.
> - You should be logged in to the Provider admin UI (`/admin`) with your owner wallet.

---

1. **Navigate to the Delegators page.** In the sidebar, click **Delegators** to open the delegators list. You'll see all delegators currently known to your Provider instance, along with their enabled/disabled status.

   ![Navigate to Delegators page](screenshots/step-01-delegators-page.png)
   <!-- Capture: The Delegators page showing the table with Name, Identity, Created At, and Enable/Disable columns. Include the Reload button in the top-right area. -->

2. **Set up your CDN URL (if you haven't already).** If you plan to import delegators from the governance CDN, confirm that `DELEGATORS_CDN_URL` is set in your environment file. The default value (`https://raw.githubusercontent.com/pokt-network/igniter-governance/refs/heads/main/{chainId}/middleman.json`) works for most setups — the `{chainId}` placeholder is replaced automatically at runtime with your configured chain. For full details on the CDN format, see the [Delegators reference](../../../apps/provider/docs/admin/delegators.md).

   ![Environment configuration for CDN URL](screenshots/step-02-cdn-url-config.png)
   <!-- Capture: A terminal or text editor showing the .env file with DELEGATORS_CDN_URL set. Blur or redact any sensitive values. -->

3. **Click Reload to sync delegators from the CDN.** On the Delegators page, click the **Reload** button next to the page heading. The Provider fetches the governance JSON, compares it with your existing list, and inserts any new entries. You should see the table refresh automatically when the import completes.

   ![Reload button on Delegators page](screenshots/step-03-reload-button.png)
   <!-- Capture: The Delegators page with the Reload button highlighted. Ideally capture the moment the table refreshes with new entries. -->

4. **Find your newly imported delegator.** New delegators from the CDN always arrive as **disabled** — this is intentional so you control which ones you accept. Use the filter bar at the top of the table and select **Disabled** to quickly surface the entries that need your attention.

   ![Filter to Disabled delegators](screenshots/step-04-filter-disabled.png)
   <!-- Capture: The Delegators table with the Disabled filter active, showing one or more newly imported delegators with the Disabled toggle visible in their row. -->

5. **Enable the delegator.** Find the delegator you want to onboard and click **Enable** in the rightmost column of their row. The button updates immediately on success — you should see it switch to **Disable**, confirming the delegator is now active. Enabling a delegator allows their Middleman instance to send keys to your Provider for staking, and your Provider begins earning a revenue share on their relays.

   ![Enable delegator toggle](screenshots/step-05-enable-delegator.png)
   <!-- Capture: The Delegators page immediately after enabling a delegator, showing the toggle in the enabled state for that row. -->

6. **Confirm the delegator is enabled with correct configuration.** Switch the filter back to **All** (or **Enabled**) and locate the delegator you just activated. Verify that their name and identity look correct. You can click the copy icon next to their identity to grab the full public key if you need it for verification.

   ![Enabled delegator in list](screenshots/step-06-verify-enabled.png)
   <!-- Capture: The Delegators table filtered to Enabled, showing the newly enabled delegator's row with the Disable button visible and the identity copy icon. -->

---

The delegator is now onboarded and enabled on your Provider. Their Middleman instance can start sending supplier keys for staking, and you'll begin earning revenue share on their relays.

**Next steps:**

- To review the full CDN JSON format and understand what happens during each import, see the [Delegators reference](../../../apps/provider/docs/admin/delegators.md).
- To track supplier keys after a delegator delivers them, see the [Key Management reference](../../../apps/provider/docs/admin/key-management.md).
