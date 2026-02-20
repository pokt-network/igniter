[< Back to Provider documentation](../../README.md)

# Relay Miners

## What are Relay Miners?

Relay miners are the nodes that perform relay work on the Pocket Network — they handle the actual traffic routing between delegators and on-chain services. In the Provider app, a relay miner represents one of your infrastructure nodes: you register it with a name, a unique identity slug, a domain, and a region. Once registered, relay miners become available for assignment to address groups, which link them to specific services and delegator keys.

Every relay miner belongs to exactly one region. Regions let you organize miners geographically and are referenced in service endpoint URL templates when staking new suppliers.

---

## Regions

Before creating relay miners, set up at least one region. Regions are short labels (e.g., "US East", "EU West") that identify the geographic location of your infrastructure.

### Create a Region

1. In the sidebar, navigate to **Admin > Regions**.
2. Click **Add New**.
3. Fill in the form:
   - **Display Name** — A human-readable label, up to 20 characters (e.g., `US East`).
   - **URL Value** — A URL-safe slug used in endpoint templates, up to 20 characters (e.g., `us-east`). Lowercase letters, numbers, and hyphens only.
4. Click **Create**.

> The URL Value is embedded in service endpoint URLs when new supplier keys are staked. If you change it after staking, affected suppliers will need to be re-staked.

<!-- SCREENSHOT: Capture the "Add New Region" dialog with sample values filled in. -->
<!-- ![Screenshot: Create region form](../screenshots/create-region.png) -->

### Update a Region

1. Navigate to **Admin > Regions**.
2. Click the pencil icon on the row you want to edit.
3. Update **Display Name** or **URL Value** as needed.
4. Click **Update**.

> Changing URL Value after miners are assigned to address groups and those groups are used in active supplier stakes will require re-staking those suppliers.

### Delete a Region

1. Navigate to **Admin > Regions**.
2. Click the trash icon on the region row.
3. Confirm deletion in the dialog.

> You cannot delete a region that has relay miners assigned to it. Remove or reassign those miners first.

---

## Create a Relay Miner

<!-- SCREENSHOT: Capture the Miners page before creating the first miner, showing the empty state and the "Add New" button. -->
<!-- ![Screenshot: Miners page empty state](../screenshots/miners-empty.png) -->

1. In the sidebar, navigate to **Admin > Miners**.
2. Click **Add New**.
3. Fill in the form:

   | Field | Description |
   |-------|-------------|
   | **Name** | A display label for this miner (e.g., `Primary US East`). Required. |
   | **Identity** | A URL-compatible slug that uniquely identifies this miner within a region (e.g., `rm-01`). Required. Lowercase letters, numbers, and hyphens only — cannot start or end with a hyphen. |
   | **Region** | Select the region this miner belongs to. The dropdown shows all configured regions. Required. |
   | **Domain** | The domain your miner is reachable at (e.g., `miner.example.com`). Used in endpoint URL construction. Required. |

4. Click **Create**.

<!-- SCREENSHOT: Capture the "Add New Relay Miner" dialog with all fields filled in. -->
<!-- ![Screenshot: Create relay miner form](../screenshots/create-relay-miner.png) -->

> The combination of **Identity + Region** must be unique across your fleet. If you attempt to create a miner with a duplicate identity-region pair, the form will return an error.

---

## Update a Relay Miner

1. Navigate to **Admin > Miners**.
2. Click the pencil icon on the miner row you want to edit.
3. Update any of the following fields:
   - **Name**
   - **Identity**
   - **Region**
   - **Domain**
4. Click **Update**.

All four fields can be changed after creation. Keep in mind:

- Changing **Identity** or **Region** may affect endpoint URLs in services already assigned to address groups that reference this miner. Review your service endpoint templates after making changes.
- Changing **Domain** updates the domain variable available in endpoint URL templates going forward.

<!-- SCREENSHOT: Capture the "Update Relay Miner" dialog with fields pre-filled. -->
<!-- ![Screenshot: Edit relay miner form](../screenshots/edit-relay-miner.png) -->

---

## Delete a Relay Miner

1. Navigate to **Admin > Miners**.
2. Click the trash icon on the miner row.
3. Confirm deletion in the dialog that appears.

> You cannot delete a relay miner that is assigned to one or more address groups. The database enforces a referential constraint — the delete operation will fail with an error notification if the miner is in use. To remove the miner, first edit or delete any address groups that reference it.

---

## Table Columns Reference

The Miners table displays the following columns:

| Column | Description |
|--------|-------------|
| Name | Display name of the relay miner |
| Identity | URL-compatible identity slug |
| Region | The region this miner is assigned to |
| Domain | The domain used in endpoint URL templates |
| Updated At | Last modified timestamp |

You can filter the table by region using the filter bar above the table.

---

## Next Steps

Once your relay miners are configured, you can assign them to address groups. Each address group links one relay miner to a set of services and delegator keys.

See [Address Groups](./address-groups.md) to continue setup.

---

**See also:** [Address Groups](./address-groups.md) · [Key Management](./key-management.md) · [Delegators](./delegators.md)
