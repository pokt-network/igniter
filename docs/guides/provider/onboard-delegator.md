[< Back to Provider Guides](../../../README.md)

# How to onboard a new delegator

> **Before you start**
>
> - Your Provider instance must be deployed and fully bootstrapped. See the [Provider setup guide](../../../apps/provider/README.md) if you haven't done this yet.
> - Delegators are automatically synced from the governance CDN every 5 minutes via the `GovernanceSync` Temporal workflow. Ensure `DELEGATORS_CDN_URL` is set in your provider-workflows configuration.
> - You should be logged in to the Provider admin UI (`/admin`) with your owner wallet.

---

1. **Navigate to the Delegators page.** In the sidebar, click **Delegators** to open the delegators list. You'll see all delegators currently known to your Provider instance, along with their enabled/disabled status.

   ![Navigate to Delegators page](screenshots/step-01-delegators-page.png)
   <!-- Capture: The Delegators page showing the table with Name, Identity, Created At, and Enable/Disable columns. Include the Reload button in the top-right area. -->

2. **Check that delegators have synced.** The `GovernanceSync` workflow runs every 5 minutes and automatically imports delegators from the governance CDN. New delegators arrive as **enabled** by default. If you need to force an immediate sync, click the **Reload** button next to the page heading — this triggers the workflow manually.

   ![Reload button on Delegators page](screenshots/step-03-reload-button.png)
   <!-- Capture: The Delegators page with the Reload button highlighted. -->

3. **Review the delegator list.** Use the filter bar at the top of the table to show **All**, **Enabled**, or **Disabled** delegators. Verify that the delegators you expect are present.

4. **Toggle delegator status if needed.** Delegators synced from governance are enabled by default. To disable one, find it and click **Disable** in the rightmost column. The button updates immediately on success — you should see it switch to **Disable**, confirming the delegator is now active. Enabling a delegator allows their Middleman instance to request supplier addresses from your Provider and initiate stake transactions that the owner signs. No private keys are ever transferred — the owner always retains custody and signs on their side.

   ![Enable delegator toggle](screenshots/step-05-enable-delegator.png)
   <!-- Capture: The Delegators page immediately after enabling a delegator, showing the toggle in the enabled state for that row. -->

5. **Confirm the delegator is enabled with correct configuration.** Switch the filter back to **All** (or **Enabled**) and locate the delegator you just activated. Verify that their name and identity look correct. You can click the copy icon next to their identity to grab the full public key if you need it for verification.

   ![Enabled delegator in list](screenshots/step-06-verify-enabled.png)
   <!-- Capture: The Delegators table filtered to Enabled, showing the newly enabled delegator's row with the Disable button visible and the identity copy icon. -->

---

The delegator is now onboarded and enabled on your Provider. Their Middleman instance can now request supplier addresses and initiate stake transactions. Once suppliers are staked, they begin servicing relays through your relay miners and you earn revenue share from the configured address groups.

**Next steps:**

- To review the full CDN JSON format and understand what happens during each import, see the [Delegators reference](../../reference/provider/delegators.md).
- To track supplier keys managed by your Provider, see the [Key Management reference](../../reference/provider/key-management.md).
