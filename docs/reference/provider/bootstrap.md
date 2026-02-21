[< Back to Provider documentation](../../../apps/provider/README.md)

# Bootstrap Wizard

## What is the Bootstrap Wizard?

The bootstrap wizard is the one-time setup flow that configures a freshly deployed Provider instance. Until bootstrap is complete, the application is not operational — no delegators can stake, no keys can be managed, and no workflows will run.

The wizard is only accessible to the wallet address set in the `OWNER_IDENTITY` environment variable. After bootstrap completes, the setup page redirects to the admin dashboard.

**How to access:** Navigate to `APP_URL/admin/setup` and sign in using SIWP (Sign-In with Pocket).

<!-- SCREENSHOT: Capture the /admin/setup page showing the stepper with all steps visible. -->
<!-- ![Screenshot: Bootstrap wizard overview](../screenshots/bootstrap-wizard.png) -->

---

## Step 1 — Blockchain Settings

Connect the Provider to the Pocket Network by entering your RPC endpoint. The app auto-detects chain parameters from the RPC.

| Field | Description |
|-------|-------------|
| **App Identity** | Your provider's public identifier, derived from the `APP_IDENTITY` private key in your environment. Read-only — displayed for reference. |
| **Shannon API URL** | The RPC endpoint for the Pocket Network (e.g., `https://sauron-rpc.beta.infra.pocket.network`). Required. After entering a valid URL, the app fetches chain parameters automatically. |
| **Network** | The chain ID detected from the RPC (e.g., `pocket-beta`). Read-only — auto-populated. Cannot be changed after bootstrap. |
| **Network Minimum Stake** | The minimum stake required on-chain, in uPOKT. Read-only — auto-populated from the RPC. |
| **Indexer API URL** | URL of the blockchain indexer, used to retrieve reward data. Required. The app validates that the indexer's network matches the detected chain ID. |

> The Network (chain ID) is locked after this step. If you need to change networks, you must redeploy with a fresh database.

<!-- SCREENSHOT: Capture Step 1 with the RPC URL filled in and chain parameters auto-populated. -->
<!-- ![Screenshot: Blockchain settings step](../screenshots/bootstrap-step1.png) -->

---

## Step 2 — Identity Settings

Set the display identity for your Provider instance.

| Field | Description |
|-------|-------------|
| **Name** | A display name for your Provider (e.g., `MyProvider US`). Required. Up to 255 characters. |
| **Support Email** | An optional contact email shown to delegators. Must be a valid email format if provided. |
| **Reward Addresses** | One or more `pokt1...` wallet addresses where you receive relay rewards. Enter one per line, or separate with commas or spaces. All entries must be valid POKT bech32 addresses. |

> Reward addresses are used by Middleman/Delegators to look up your provider's on-chain rewards. These must match the revenue-share addresses you configure in address groups. If they don't match, delegators will not see your rewards.

<!-- SCREENSHOT: Capture Step 2 with name and reward addresses filled in. -->
<!-- ![Screenshot: Identity settings step](../screenshots/bootstrap-step2.png) -->

---

## Step 3 — Configure Regions

Define the geographic regions where your relay miners operate. You need at least one region before you can add relay miners.

1. Click **Add Region** (or **Add your first Region** if the list is empty).
2. Fill in the dialog:

| Field | Description |
|-------|-------------|
| **Display Name** | A human-readable label (e.g., `US East`). Required. Up to 20 characters. Must be unique across all regions. |
| **URL Value** | A URL-safe slug used in endpoint URL templates (e.g., `us-east`). Required. Up to 20 characters. Lowercase letters, numbers, and hyphens only. Must be unique. |

3. Click **Create**.

Repeat to add as many regions as you need. You can edit or delete regions from the table using the pencil and trash icons.

> The URL Value is embedded in service endpoint URLs when supplier keys are staked. Changing it after staking requires re-staking affected suppliers.

> You cannot proceed to the next step until at least one region exists.

<!-- SCREENSHOT: Capture Step 3 with one or two regions in the table. -->
<!-- ![Screenshot: Configure regions step](../screenshots/bootstrap-step3.png) -->

---

## Step 4 — Configure Relay Miners

Register the relay miner nodes that your Provider will manage. You need at least one relay miner.

1. Click **Add Relay Miner** (or **Add your first Relay Miner** if the list is empty).
2. Fill in the dialog:

| Field | Description |
|-------|-------------|
| **Name** | A display label for this miner (e.g., `Primary US East`). Required. |
| **Identity** | A URL-compatible slug that uniquely identifies this miner within a region (e.g., `rm-01`). Required. Lowercase letters, numbers, and hyphens only — cannot start or end with a hyphen. Up to 66 characters. |
| **Region** | Select the region this miner belongs to. The dropdown shows all regions created in Step 3. Required. |
| **Domain** | The domain your miner is reachable at (e.g., `miner.example.com`). Used in endpoint URL construction. Required. |

3. Click **Create**.

> The combination of **Identity + Region** must be unique. If you attempt to create a miner with a duplicate identity-region pair, the form will return an error.

> You cannot proceed to the next step until at least one relay miner exists.

<!-- SCREENSHOT: Capture Step 4 with the Add Relay Miner dialog open. -->
<!-- ![Screenshot: Configure relay miners step](../screenshots/bootstrap-step4.png) -->

---

## Step 5 — Select Provided Services

Register the on-chain Pocket Network services your relay miners will serve (e.g., Ethereum mainnet, Arbitrum). You need at least one service.

1. Click **Add service** (or **Add your first service** if the list is empty).
2. In the **Service ID** field, enter the on-chain service ID (e.g., `eth-mainnet`). The app fetches the service's on-chain details automatically.
3. Once the on-chain details load in the left panel (name, owner address, compute units), the right panel becomes active.
4. Configure one or more protocol endpoints:

| Field | Description |
|-------|-------------|
| **RPC Type** | The protocol type (e.g., JSON-RPC, REST). Each endpoint must have a unique RPC type. Required. |
| **URL** | The endpoint URL your miner serves for this protocol. Supports dynamic placeholders (see below). Required. |

**URL placeholders:**

| Placeholder | Replaced with |
|-------------|---------------|
| `{rm}` | The relay miner's identity slug |
| `{region}` | The region's URL value |
| `{sid}` | The on-chain service ID |
| `{type}` | A URL-friendly label for the RPC protocol |
| `{domain}` | The miner's domain |

5. Click **Add Service**.

> The Service ID and on-chain metadata (name, owner, compute units) cannot be changed after creation — they are fetched from the chain. Each service must have at least one endpoint.

> You cannot proceed to the next step until at least one service exists.

<!-- SCREENSHOT: Capture Step 5 with a service loaded and an endpoint configured. -->
<!-- ![Screenshot: Select services step](../screenshots/bootstrap-step5.png) -->

---

## Step 6 — Address Groups

Create address groups to link relay miners with services and define revenue sharing. You need at least one address group. For full details on address group configuration, see the [Address Groups](./address-groups.md) guide.

1. Click **Add address Group** (or **Add your first Address Group** if the list is empty).
2. Fill in the left panel:

| Field | Description |
|-------|-------------|
| **Name** | A display label for this group (e.g., `US East - ETH`). Required. |
| **Relay Miner** | Select the relay miner this group routes traffic through. Required. |

3. Configure **Default Revenue Shares** — these pre-fill for each service you assign:
   - **Add Supplier Share** toggle and percentage (1–100).
   - **Add Share** entries for delegator addresses and percentages.

4. Use the **Assign services** combobox to add services. Each appears in the right panel where you can override revenue share per-service.

5. Optionally toggle **Internal use only** to hide this group from delegators.

6. Click **Add Address Group**.

> Total of all shares (supplier + delegator entries) for a given service cannot exceed 100%.

> You cannot proceed to the next step until at least one address group exists.

<!-- SCREENSHOT: Capture Step 6 with the address group dialog open. -->
<!-- ![Screenshot: Address groups step](../screenshots/bootstrap-step6.png) -->

---

## Step 7 — Delegators

Review and enable the delegators (Middleman operators) that can stake through your Provider. The list is automatically synced from the CDN configured in `DELEGATORS_CDN_URL`.

When this step loads, the app fetches the latest delegator list from the CDN. You can then:

- **Select All** — Enable all delegators at once.
- **Disable All** — Disable all delegators at once.
- Toggle individual delegators using their row controls.

| Column | Description |
|--------|-------------|
| **Name** | The delegator's display name (from the CDN source). |
| **Identity** | The delegator's unique public key identifier. |
| **Enabled** | Whether this delegator is allowed to stake through your Provider. |

> You cannot proceed to the next step until at least one delegator exists in the list.

<!-- SCREENSHOT: Capture Step 7 with the delegator table showing enabled/disabled states. -->
<!-- ![Screenshot: Delegators step](../screenshots/bootstrap-step7.png) -->

---

## Completing Bootstrap

After all 7 steps are complete, the wizard shows a **Finish** confirmation step. Click **Complete** to finalize bootstrap. This sets the `isBootstrapped` flag in the database and redirects you to the admin dashboard.

Once bootstrapped, the setup page is no longer accessible — navigating to `/admin/setup` redirects to `/admin`.

> Bootstrap is a one-time operation. The settings configured during bootstrap (blockchain, identity, regions, miners, services, groups, delegators) can all be managed afterward from the admin sidebar. See the [Next Steps](#next-steps) section for guides on each area.

---

## Next Steps

After bootstrap, manage your Provider through the admin interface:

- [Relay Miners](./relay-miners.md) — Add, update, or remove relay miner nodes
- [Address Groups](./address-groups.md) — Manage groups, services, and revenue share configuration
- [Key Management](./key-management.md) — Import, track, and export supplier keys
- [Delegators](./delegators.md) — Enable or disable delegators and manage revenue sharing

---

**See also:** [Relay Miners](./relay-miners.md) · [Address Groups](./address-groups.md) · [Key Management](./key-management.md) · [Delegators](./delegators.md)
