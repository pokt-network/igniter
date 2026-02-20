[< Back to Provider documentation](../../README.md)

# Delegator Management

## What is Delegator Management?

Delegators are entities — typically Middleman operators — that delegate their staking keys to your Provider to operate on their behalf. When a delegator's keys are staked through your Provider, their suppliers earn rewards on the Pocket Network and your Provider earns a revenue share in return. The Delegators page is where you import who is allowed to use your Provider, control which delegators are active, and manage revenue share.

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

Enabling a delegator allows them to send keys to your Provider for staking. Disabling stops their keys from being delivered, though keys already staked are unaffected — staking is managed by the Pocket Network itself.

**Steps:**

1. Navigate to **Delegators**.
2. Find the delegator you want to toggle.
3. Click **Enable** or **Disable** in the rightmost column of the row. The button updates immediately on success.

> To enable or disable all delegators at once, use the bulk actions available during setup or via the API.

---

## Import from CDN

The Pocket Network governance repository maintains a public JSON file listing approved delegator addresses for each chain. Importing from this CDN adds new delegators to your Provider and updates or disables any that have changed identity — keeping your list in sync with the ecosystem.

### Configure the CDN URL

Before importing, ensure the `DELEGATORS_CDN_URL` environment variable is set in your environment file. The default value points to the governance repository:

```
DELEGATORS_CDN_URL="https://raw.githubusercontent.com/pokt-network/igniter-governance/refs/heads/main/{chainId}/middleman.json"
```

The `{chainId}` placeholder is automatically replaced at runtime with your configured chain ID (e.g., `pocket`, `pocket-beta`, `pocket-alpha`). You do not need to edit the URL template — just set it and the Provider substitutes the correct chain at import time.

To find the raw JSON endpoint for your chain:

1. Go to the [pokt-network/igniter-governance](https://github.com/pokt-network/igniter-governance) repository on GitHub.
2. Navigate to the folder named after your chain ID (e.g., `pocket-beta/`).
3. Open `middleman.json`. The raw URL to this file is what goes into `DELEGATORS_CDN_URL` (with `{chainId}` as the template).

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

### Trigger the import

1. Navigate to **Delegators**.
2. Click the **Reload** button next to the page heading.
3. The Provider fetches the CDN JSON, compares it with existing delegators, and applies changes:
   - **New delegators** are inserted as **disabled** — you control which ones you accept.
   - **Existing delegators** with an updated name or identity are updated in place.
   - **Delegators no longer in the CDN** that are currently enabled are disabled automatically.
4. The table refreshes automatically after the import completes.

### What happens during import

The `UpdateDelegatorsFromSource` action performs the sync in a single database transaction:

1. Fetches the CDN JSON over HTTPS.
2. Matches each CDN entry to existing delegators by identity and identity history.
3. Inserts new delegators (disabled by default).
4. Updates name or identity for delegators that have changed.
5. Disables any previously-enabled delegator no longer present in the CDN.

> **New delegators are always imported as disabled.** After importing, review the list and enable the delegators you want to accept.

### Verify the import succeeded

1. After clicking Reload, the table refreshes. Look for new entries.
2. Filter by **Disabled** to see newly imported delegators that need to be enabled.
3. Enable the delegators you want to accept by clicking **Enable** in their row.

<!-- SCREENSHOT: Capture the Delegators page with the Reload button highlighted. Then capture the table immediately after import showing newly added disabled delegators. -->
<!-- ![Screenshot: Delegators CDN import](../screenshots/delegators-cdn-import.png) -->

---

## Import Suppliers (from Middleman)

The **Import Suppliers** flow is how a connected Middleman instance sends its delegator's keys to the Provider. This is a machine-to-machine API flow — operators do not trigger it manually. Understanding it helps you verify integrations and diagnose issues.

### The three-step API flow

A Middleman instance goes through three steps to deliver suppliers to the Provider:

**Step 1: Request** — `POST /api/import-suppliers/request`

The Middleman sends the delegator owner's address and any addresses it already has. The Provider finds matching staked suppliers for that owner, creates an import request with a one-time nonce, and returns the nonce and how many suppliers matched. The request expires after 15 minutes.

**Step 2: Submit** — `POST /api/import-suppliers/submit`

The Middleman signs the nonce with the owner's private key and sends the signature back along with the owner's public key, delegator rewards address, and revenue share percentage. The Provider verifies the signature, then delivers the matching supplier keys to the delegator in the database.

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
- [Address Groups](./address-groups.md) — Configure how keys are grouped and presented to delegators.

---

**See also:** [Relay Miners](./relay-miners.md) · [Address Groups](./address-groups.md) · [Key Management](./key-management.md)
