[< Back to Provider documentation](../../../apps/provider/README.md)

# Delegator Management

## What is Delegator Management?

Delegators are entities — typically Middleman operators — that stake suppliers through your Provider's infrastructure. They request supplier addresses from your Provider, and the owner signs the stake transaction on their side. No private keys are ever transferred. Once suppliers are staked, they service relays through your relay miners and your Provider earns a revenue share from the configured address groups. The Delegators page is where you manage who is allowed to use your Provider and control which delegators are active.

Delegators are identified by their Pocket Network public key (their **identity**). The Provider ships with a governance-maintained list of approved delegators that you can import from a CDN, making it straightforward to stay in sync with the ecosystem.

---

## View Delegators

The Delegators page shows all delegators currently known to your Provider instance.

**Steps:**

1. In the sidebar, navigate to **Delegators**.
2. The table shows each delegator's **Name**, **Identity** (abbreviated with a copy button), **Created At** date, and an **Enable/Disable** toggle button.
3. Use the filter bar at the top to show **All**, **Enabled**, or **Disabled** delegators.
4. Click the copy icon next to any identity to copy the full public key to your clipboard.

<!-- SCREENSHOT: Capture the Delegators table with a mix of enabled and disabled delegators visible. Include the filter bar with the Enabled filter selected. -->
<!-- ![Screenshot: Delegators table](../screenshots/delegators-table.png) -->

---

## Enable or Disable a Delegator

Enabling a delegator allows their Middleman instance to request supplier addresses from your Provider and initiate stake transactions. Disabling prevents new staking requests, though suppliers already staked are unaffected — staking is managed by the Pocket Network itself.

**Steps:**

1. Navigate to **Delegators**.
2. Find the delegator you want to toggle.
3. Click **Enable** or **Disable** in the rightmost column of the row. The button updates immediately on success.

> To enable or disable all delegators at once, use the bulk actions available during setup or via the API.

---

## Governance Sync

The Pocket Network governance repository maintains a public JSON file listing approved delegator addresses for each chain. A scheduled Temporal workflow (`GovernanceSync`) automatically fetches this list every 5 minutes and syncs it with your Provider's database — keeping your delegator list up to date with the ecosystem.

### Configure the CDN URL

Ensure the `DELEGATORS_CDN_URL` environment variable is set in the **provider-workflows** configuration. The default value points to the governance repository:

```
DELEGATORS_CDN_URL="https://raw.githubusercontent.com/pokt-network/igniter-governance/refs/heads/main/{chainId}/middleman.json"
```

The `{chainId}` placeholder is automatically replaced at runtime with your configured chain ID (e.g., `pocket`, `pocket-beta`). In local development with Tilt, this is overridden to point to the local `governance-nginx` service.

### What the JSON contains

The CDN JSON is an array of delegator entries:

```json
[
  {
    "name": "Middleman Provider A",
    "identity": "pokt1abc...xyz",
    "identityHistory": ["pokt1old...abc"]
  }
]
```

- `name` — human-readable name shown in the UI.
- `identity` — the delegator's current Pocket Network address.
- `identityHistory` — previous addresses, used to match delegators that have rotated their identity.

### How the sync works

The `GovernanceSync` workflow runs as a Temporal scheduled workflow every 5 minutes. On each run it:

1. Fetches the CDN JSON over HTTPS.
2. Matches each CDN entry to existing delegators by identity and identity history.
3. Inserts new delegators as **enabled** by default.
4. Updates name or identity for delegators that have changed.
5. Disables any previously-enabled delegator no longer present in the CDN.

### Manual trigger

1. Navigate to **Delegators**.
2. Click the **Reload** button next to the page heading.
3. This triggers the `GovernanceSync` Temporal workflow immediately.
4. The table refreshes automatically after a short delay.

### Verify the sync

1. After clicking Reload or waiting for the scheduled run, check the table for new entries.
2. Filter by **Enabled** or **Disabled** to review the current state.

---

## Import Suppliers (from Middleman)

The **Import Suppliers** flow is how a connected Middleman instance claims already-staked suppliers from the Provider. This is a machine-to-machine API flow — operators do not trigger it manually. Understanding it helps you verify integrations and diagnose issues.

### The three-step API flow

A Middleman instance goes through three steps to import suppliers from the Provider:

**Step 1: Request** — `POST /api/import-suppliers/request`

The Middleman sends the supplier owner's address and any addresses it already has. The Provider finds matching staked suppliers for that owner, creates an import request with a one-time nonce, and returns the nonce and how many suppliers matched. The request expires after 15 minutes.

**Step 2: Submit** — `POST /api/import-suppliers/submit`

The Middleman signs the nonce with the owner's private key and sends the signature back along with the owner's public key, delegator rewards address, and revenue share percentage. The Provider verifies the signature, then assigns the matching suppliers to the delegator in the database.

**Step 3: Status** — `POST /api/import-suppliers/status`

The Middleman can poll this endpoint to confirm the import completed. The response includes the import request status and — for completed requests — the list of imported supplier addresses.

### Import request lifecycle

| Status | Meaning |
|--------|---------|
| `pending` | Request created, waiting for the Middleman to submit the signed nonce. |
| `completed` | Signature verified and suppliers assigned to the delegator. |
| `expired` | The 15-minute window passed before the Middleman submitted. The Middleman must start a new request. |
| `cancelled` | A new request was initiated by the same delegator before this one completed (the old one is cancelled automatically). |
| `failed` | Signature verification failed, the public key didn't match, or no suppliers were available. |

### What happens to keys after import

Once suppliers are assigned during the Submit step, the affected keys move to the `Delivered` state, with the delegator's identity and the delivery timestamp recorded. From there, the staking process takes over automatically. See [key-management.md](./key-management.md) for the full key lifecycle.

### Verifying a completed import

1. Navigate to **Keys**.
2. Filter by **State: Delivered** to see keys recently assigned to a delegator.
3. The **Delivered To** column shows the delegator name.
4. Click the arrow on any row to see the key detail panel, which shows the delegator name and delivery timestamp.

---

## Related

- [Key Management](./key-management.md) — Track keys through their full lifecycle from import to staking and beyond.
- [Address Groups](./address-groups.md) — Configure how keys are grouped and how staking is organized.

---

**See also:** [Relay Miners](./relay-miners.md) · [Address Groups](./address-groups.md) · [Key Management](./key-management.md)
