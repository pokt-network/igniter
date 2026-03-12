[< Back to Provider documentation](../../../apps/provider/README.md)

# Address Groups

## What are Address Groups?

Address groups are the central organizing concept in the Provider app. Each group links a relay miner to one or more on-chain services, along with the revenue share configuration that determines how relay earnings are split between the supplier, the operator, and the supplier owner. When a supplier is staked through the Provider, it is staked under a specific address group — meaning it will route traffic through that group's relay miner and service configuration.

Think of an address group as a "slot": it defines the infrastructure context (which miner, which region, which services) and the economic parameters (revenue share) for a set of supplier keys.

> Before creating an address group, you need at least one relay miner and one service configured. See [Relay Miners](./relay-miners.md) to set up miners, and the [Services](#configure-services) section below for service setup.

---

## Create an Address Group

<!-- SCREENSHOT: Capture the Groups page before the first group is created, showing the empty state and the "Add New" button. -->
<!-- ![Screenshot: Groups page empty state](../screenshots/groups-empty.png) -->

1. In the sidebar, navigate to **Admin > Groups**.
2. Click **Add New**.
3. Fill in the left panel fields:

### Basic Configuration

| Field | Description |
|-------|-------------|
| **Name** | A display label for this group (e.g., `US East - ETH`). Required. |
| **Relay Miner** | Select the relay miner this group will route traffic through. The dropdown shows each miner's name, identity, and region. Required. |

### Default Revenue Shares

Set a default revenue share configuration that pre-fills each service you add to this group. You can override per-service after adding.

- **Add Supplier Share** toggle — Enable to reserve a percentage for the supplier key itself. This funds the on-chain transactions (claim and proof) the supplier must submit each session.
- **Supplier share %** — The percentage of relay earnings reserved for the supplier key (1–100). Only active when the toggle is on.
- **Add Share** — Add additional revenue share entries. Each entry requires:
  - **Address** — A valid `pokt…` Cosmos address (typically the operator's own reward address).
  - **Share %** — Percentage of relay earnings going to this address (1–100).

> Total of all shares (supplier + operator entries) across a service cannot exceed 100%. The remaining percentage is what the supplier owner receives.

### Assign Services

Use the **Assign services** combobox to add on-chain services to this group. Search by name and select one at a time. Each added service appears in the right panel where you can configure its revenue share independently.

<!-- SCREENSHOT: Capture the "Add New AddressGroup" dialog with a relay miner selected and at least one service assigned in the right panel. -->
<!-- ![Screenshot: Create address group form](../screenshots/create-address-group.png) -->

### Per-Service Revenue Share (Right Panel)

For each assigned service, the right panel shows:
- The service name and on-chain ID.
- A preview of the interpolated endpoint URLs based on the selected relay miner's identity, region, and domain.
- An **Add Supplier Share** toggle and percentage input.
- **Add Share** to add per-service revenue share entries (e.g., operator reward address).
- **Remove** to detach the service from this group.

### Visibility

| Field | Description |
|-------|-------------|
| **Internal use only** toggle | When enabled, this group is marked as private and not visible to stakers browsing your provider. |

### Linked Addresses

Linked Addresses are `pokt…` wallet addresses that are explicitly associated with this group, independent of the staking lifecycle. Use **Add Address** to add entries; each must be a valid Cosmos address with a `pokt` prefix. Each address must be unique within the group.

4. Click **Add Address Group** to save.

---

## Update an Address Group

1. Navigate to **Admin > Groups**.
2. Click the pencil icon on the group row you want to edit.
3. The same form opens, pre-filled with the current configuration.
4. You can update any field:
   - **Name**
   - **Relay Miner** — Changing this affects the endpoint URLs previewed for assigned services and the actual routing for any new staking operations.
   - **Default Revenue Shares** — Changes apply as defaults when adding new services; existing per-service configurations are not retroactively updated.
   - **Assigned services** — Add or remove services. Removing a service from a group does not affect already-staked keys; those keys retain their configuration until re-staked.
   - **Internal use only** toggle
   - **Linked Addresses**
5. Click **Update Address Group** to save.

> Changing the relay miner on a group with existing staked keys does not automatically re-stake those keys. Changes take effect for future staking operations only.

<!-- SCREENSHOT: Capture the "Update AddressGroup" dialog with the group pre-filled and the right panel showing assigned services. -->
<!-- ![Screenshot: Edit address group form](../screenshots/edit-address-group.png) -->

---

## Delete an Address Group

1. Navigate to **Admin > Groups**.
2. Click the trash icon on the group row.
3. Confirm deletion in the dialog.

> Address groups that have keys associated with them are protected from deletion. The app will show a warning notification and prevent the delete if any keys are linked to the group. This protection exists to prevent accidental disruption to active staking configurations. Support for removing groups with associated keys will be added in a future version.

---

## Configure Services

Services represent the on-chain Pocket Network services your relay miners will serve (e.g., Ethereum, Arbitrum). Each service in the Provider app maps to an on-chain service ID and stores the endpoint configuration your miners use to handle relay requests.

### Create a Service

1. In the sidebar, navigate to **Admin > Services**.
2. Click **Add New**.
3. In the **Service ID** field, enter the on-chain service ID (e.g., `eth`). The app fetches the service's on-chain details automatically after a short delay.
4. Once the on-chain details load in the left panel (name, owner, compute units), the right panel becomes active.
5. Configure one or more protocol endpoints:
   - **RPC Type** — Select the protocol (e.g., JSON-RPC, REST). Each endpoint must have a unique RPC type.
   - **URL** — The endpoint URL your miner serves for this protocol. Supports dynamic placeholders:

     | Placeholder | Replaced with |
     |-------------|---------------|
     | `{rm}` | The relay miner's identity (slug) |
     | `{region}` | The region's URL value |
     | `{sid}` | The on-chain service ID |
     | `{type}` | A URL-friendly label for the RPC protocol |
     | `{domain}` | The miner's domain (or app-level domain) |

   Click the info icon next to a URL field to preview how placeholders resolve with example values.

6. Click **Add Service** to save.

<!-- SCREENSHOT: Capture the "Add New Service" dialog with an on-chain service loaded on the left and an endpoint configured on the right. -->
<!-- ![Screenshot: Create service form](../screenshots/create-service.png) -->

### Update a Service

1. Navigate to **Admin > Services**.
2. Click the pencil icon on the service row.
3. You can update:
   - **Endpoint URLs** and **RPC Types** for existing endpoints.
   - **Revenue Share Percentage** — A global percentage that applies at the service level (distinct from per-address-group revenue share).
4. Click **Update Service**.

> The Service ID and on-chain metadata (name, owner, compute units) cannot be changed after creation — these are pulled from the chain. To change the on-chain configuration, delete and re-create the service.

### Delete a Service

1. Navigate to **Admin > Services**.
2. Click the trash icon on the service row.
3. Confirm deletion.

> Deleting a service removes it from the Provider app's local database. This does not affect the on-chain service registration. If the service is assigned to any address groups, remove it from those groups first.

---

## Revenue Share Configuration

Revenue share determines how relay earnings are split between the supplier key, the operator, and the supplier owner. The Provider app implements two fee modes from the `ProviderFee` enum:

### Fee Types

| Type | Value | Behavior |
|------|-------|----------|
| **UpTo** | `up_to` | The operator takes up to a specified percentage, with the remainder going to the supplier owner. The actual split depends on the agreed configuration. |
| **Fixed** | `fixed` | The operator takes exactly the specified percentage, regardless of other factors. |

In practice, when configuring revenue shares within an address group:

- **Supplier Share** — A percentage reserved for the supplier key to fund on-chain claim/proof transactions.
- **Operator Share** — Use **Add Share** to add your own reward address and the percentage you want to keep as the provider operator.
- The combined total of all share percentages for a given service cannot exceed 100%. The remaining percentage is what the supplier owner receives.

### Setting Revenue Share

Revenue share is configured at two levels:

1. **Default Revenue Shares** (group level) — Set once when creating/editing the group. This becomes the starting configuration applied to each new service you assign.
2. **Per-Service Revenue Shares** (right panel) — Override the default for a specific service. Useful when different services have different economic agreements.

To modify revenue share on an existing group, edit the group and update the share entries in the right panel for each service.

---

## Table Columns Reference

The Groups table displays the following columns:

| Column | Description |
|--------|-------------|
| Name | Display name of the address group |
| Relay Miner | The assigned miner's name and identity |
| Services | Badges showing assigned service names (up to 3, with a "+N" overflow indicator) |
| Private | Whether the group is marked as internal-only |
| Keys | Number of staked keys currently assigned to this group |
| Linked Addresses | Count of explicitly linked addresses |
| Updated At | Last modified timestamp |

You can filter by visibility (All / Private / Public) using the filter bar above the table.

---

**See also:** [Relay Miners](./relay-miners.md) · [Key Management](./key-management.md) · [Delegators](./delegators.md)
