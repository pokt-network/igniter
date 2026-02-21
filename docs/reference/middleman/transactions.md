[< Back to Middleman documentation](../../../apps/middleman/README.md)

# Transactions

The transactions page shows a history of all staking operations processed by this Middleman instance. Each row represents a stake, unstake, upstake, or operational funds transaction with its current status. Use this view to track pending transactions, identify failures, and review completed operations.

Middleman has two transaction views — one scoped to the connected wallet's transactions and one showing all transactions across all users.

<!-- SCREENSHOT: Capture the /app/transactions or /admin/transactions page showing the full transactions table with columns and at least one transaction visible. -->
<!-- ![Screenshot: Transactions table](../screenshots/transactions-table.png) -->

---

## Table Columns

| Column | Description |
|--------|-------------|
| **Type** | Transaction type with an icon indicator. The icon is rotated 180° for unstake transactions. Displays a warning icon when the transaction status is Failure. |
| **Status** | Current transaction status. Displays a warning icon when status is Failure. |
| **Height** | Blockchain execution height — the block at which the transaction was executed on-chain. |
| **Created At** | Timestamp when the transaction was created in Middleman. |
| **Total POKT** | Total POKT amount involved in the transaction. |
| **Actions** | Arrow button to open the transaction detail panel. |

---

## Transaction Types

| Type | Description |
|------|-------------|
| **Stake** | A new staking transaction — allocates POKT to supplier nodes |
| **Unstake** | Removes nodes from active staking |
| **Upstake** | Additional staking on existing nodes (increasing an existing stake) |
| **Operational Funds** | Transaction for operational funding purposes |

---

## Transaction Statuses

| Status | Description |
|--------|-------------|
| **Pending** | Transaction submitted and awaiting on-chain confirmation |
| **Success** | Transaction confirmed and completed on-chain |
| **Failure** | Transaction failed — check the detail panel for specifics |
| **Not Executed** | Transaction was created in Middleman but was not executed on-chain |

---

## Filtering and Sorting

### Type/Status Filter Group

The filter bar lets you narrow the table by type or status:

| Filter | Matches |
|--------|---------|
| All Transactions | All transactions (default) |
| Stake | Transactions of type Stake |
| Upstake | Transactions of type Upstake |
| Unstake | Transactions of type Unstake |
| Success | Transactions with status Success |
| Failure | Transactions with status Failure |
| Pending | Transactions with status Pending |

### Sort Options

| Sort | Description |
|------|-------------|
| Most Recent | Sort by created date, newest first (default) |
| Amount | Sort by Total POKT amount, descending |
| Status | Sort by status, ascending |
| Type | Sort by type, ascending |

---

## Transaction Detail Panel

Clicking the arrow button in the Actions column opens a side panel with full transaction details:

| Field | Description |
|-------|-------------|
| Transaction ID | Internal Middleman transaction identifier |
| Type | Transaction type (Stake, Unstake, Upstake, Operational Funds) |
| Status | Current status (Pending, Success, Failure, Not Executed) |
| Created Date | When the transaction was created |
| Operations | List of individual operations included in the transaction |
| Transaction Hash | On-chain transaction hash (once executed) |
| Estimated Fee | Fee estimated at transaction creation time |
| Consumed Fee | Actual fee consumed on-chain (once confirmed) |
| Provider Name | The provider that executed this transaction |
| Provider Fee | The provider's fee amount and type (UpTo or Fixed) |

---

## User vs. Admin View

| View | Path | Scope |
|------|------|-------|
| User Transactions | `/app/transactions` | Transactions for the connected wallet owner only |
| Admin Transactions | `/admin/transactions` | All transactions across all users managed by this Middleman instance |

Both views share the same columns, filters, and sorting options.

---

**See also:** [Staking](./staking.md) · [Unstaking](./unstaking.md) · [Import Suppliers](./import-suppliers.md) · [Overview](./overview.md)
