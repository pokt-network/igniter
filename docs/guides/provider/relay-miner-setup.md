[< Back to Provider Guides](../../../README.md)

# How to set up a relay miner with address groups

> **Before you start**
>
> - Your Provider instance must be deployed and fully bootstrapped. See the [Provider setup guide](../../../apps/provider/README.md) if you haven't done this yet.
> - You'll need the domain your relay miner node is reachable at (e.g., `miner.example.com`).
> - You'll need to know which on-chain service IDs you want to serve (e.g., `eth`, `arb-one`). These must already exist on the Pocket Network for the service lookup to work.
> - You should be logged in to the Provider admin UI (`/admin`) with your owner wallet.

---

1. **Navigate to the Relay Miners page.** In the sidebar, click **Admin > Miners** to open the miners list. This is where you'll register the infrastructure nodes your Provider manages.

   ![Relay Miners page](screenshots/step-01-relay-miners-page.png)
   <!-- Capture: The Miners page showing either an empty state with the Add New button, or the miners table. Include the sidebar with Admin > Miners highlighted. -->

2. **Create a region first.** Every relay miner belongs to a region. In the sidebar, click **Admin > Regions**, then click **Add New**. Fill in a **Display Name** (e.g., `US East`) and a **URL Value** slug (e.g., `us-east` — lowercase letters, numbers, and hyphens only). Click **Create**. The URL Value is embedded in service endpoint URLs when supplier keys are staked, so choose something stable.

   ![Create region form](screenshots/step-02-create-region.png)
   <!-- Capture: The Add New Region dialog with the Display Name and URL Value fields filled in with sample values. -->

3. **Confirm your region appears in the list.** After creating, you should see the new region in the Regions table. If you need multiple regions for different data centers or geographies, add them all now before moving on.

   ![Regions list with new region](screenshots/step-03-regions-list.png)
   <!-- Capture: The Regions table showing the newly created region with its Display Name and URL Value visible. -->

4. **Navigate back to Miners and create a relay miner.** Click **Admin > Miners** in the sidebar, then click **Add New**. Fill in the form:
   - **Name** — a display label (e.g., `Primary US East`)
   - **Identity** — a URL-compatible slug unique within this region (e.g., `rm-01`)
   - **Region** — select the region you just created from the dropdown
   - **Domain** — the domain your miner node is reachable at (e.g., `miner.example.com`)

   Click **Create**. The combination of Identity + Region must be unique across your fleet.

   ![Create relay miner form](screenshots/step-04-create-relay-miner.png)
   <!-- Capture: The Add New Relay Miner dialog with all four fields filled in with sample values. Show the Region dropdown open or with a region selected. -->

5. **Confirm the miner appears in the Miners list.** You should see the new relay miner in the table with its Name, Identity, Region, and Domain columns. If the entry appears, your miner is registered and ready to be assigned to an address group.

   ![Miners list with new miner](screenshots/step-05-miners-list.png)
   <!-- Capture: The Miners table showing the newly created relay miner row with all columns visible. -->

6. **Navigate to the Address Groups page.** In the sidebar, click **Admin > Groups**. Address groups link your relay miner to on-chain services and define how relay earnings are split between you and your delegators. For the full field reference and advanced options, see the [Relay Miners reference](../../reference/provider/relay-miners.md) and [Address Groups reference](../../reference/provider/address-groups.md).

   ![Address Groups page](screenshots/step-06-address-groups-page.png)
   <!-- Capture: The Address Groups (Groups) page showing either an empty state or the groups table. Include the Add New button. -->

7. **Create an address group.** Click **Add New**. Fill in the left panel:
   - **Name** — a label for this group (e.g., `US East - ETH`)
   - **Relay Miner** — select the miner you just created from the dropdown

   Leave the revenue share fields at their defaults for now — you can fine-tune them per service in the next step.

   ![Create address group form - left panel](screenshots/step-07-create-address-group.png)
   <!-- Capture: The Add New AddressGroup dialog with the Name filled in and a relay miner selected from the dropdown. Show the left panel before adding services. -->

8. **Assign a service to the group.** In the **Assign services** combobox on the same form, search for your service by name or ID (e.g., `eth`) and select it. The service appears in the right panel, where you'll see a preview of the interpolated endpoint URLs based on your miner's identity, region, and domain. Confirm the URLs look correct.

   ![Address group with service assigned](screenshots/step-08-assign-service.png)
   <!-- Capture: The Add New AddressGroup dialog with a service assigned in the right panel. Show the endpoint URL preview. -->

9. **Configure revenue share for the group.** In the right panel for your assigned service, configure the **Supplier Share** percentage to fund on-chain claim/proof transactions. Then use **Add Share** to add your own operator reward address and percentage. The remaining percentage up to 100% is what the supplier owner receives. Click **Add Address Group** to save.

   ![Revenue share configuration](screenshots/step-09-revenue-share.png)
   <!-- Capture: The right panel of the Add New AddressGroup dialog showing the Add Supplier Share toggle enabled with a percentage, and at least one delegator share entry with {of} as the address. -->

10. **Verify the complete setup.** Back on the Groups page, find your new address group in the table. Confirm it shows the correct relay miner, your assigned service badge(s), and the right visibility setting. Your relay miner is now registered, linked to a region, and associated with an address group that's ready for staking.

    ![Address group in list](screenshots/step-10-verify-group.png)
    <!-- Capture: The Address Groups table showing the newly created group row with Relay Miner, Services badge(s), and other columns visible. -->

---

Your relay miner is fully set up with address groups and services. When a delegator stakes suppliers through their Middleman instance, the suppliers are staked under this group — routing traffic through your miner with the revenue share configuration you defined.

**Next steps:**

- To import and manage supplier keys, see the [How to manage your key inventory](./key-inventory.md) guide.
- For the full field reference and advanced configuration options, see the [Relay Miners reference](../../reference/provider/relay-miners.md) and the [Address Groups reference](../../reference/provider/address-groups.md).
