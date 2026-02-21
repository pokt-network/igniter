[< Back to Provider Guides](../../../README.md)

# How to manage your key inventory

> **Before you start**
>
> - Your Provider instance must be deployed and fully bootstrapped. See the [Provider setup guide](../../../apps/provider/README.md) if you haven't done this yet.
> - You need at least one address group set up before importing keys — keys must be assigned to a group on import. See the [How to set up a relay miner with address groups](./relay-miner-setup.md) guide if you need to create one first.
> - Your keys file must be a JSON array of hex-encoded private keys. For the exact format, see the [Key Management reference](../../reference/provider/key-management.md).
> - You should be logged in to the Provider admin UI (`/admin`) with your owner wallet.

---

1. **Navigate to the Key Management page.** In the sidebar, click **Keys** to open the keys list. This is the central view for all supplier keys managed by your Provider — you'll import, track, filter, and export from here.

   ![Key Management page](screenshots/step-01-keys-page.png)
   <!-- Capture: The Keys page showing the table with Address, Address Group, Owner, State, Delivered To, and Created At columns. Include the Import and Export buttons in the top-right area. -->

2. **Click Import to open the import panel.** In the top-right area of the page, click **Import**. The Import Addresses panel slides open. Select your target **Address Group** from the dropdown — you'll see the group name and its visibility (public or private) displayed below the selector. This is the group all keys in the file will be assigned to.

   ![Import panel with address group selected](screenshots/step-02-import-panel.png)
   <!-- Capture: The Import Addresses panel open with an address group selected from the dropdown. Show the group name and visibility indicator below the selector, and the upload area. -->

3. **Upload your keys file.** Drag and drop your JSON keys file onto the upload area in the panel, or click to browse and select it. Then click **Import Keys**. A progress dialog shows two stages — Validating File and Importing Keys — and you'll see how many keys were imported when it completes. Click **Close** to return to the list.

   ![Import progress and success screen](screenshots/step-03-import-success.png)
   <!-- Capture: The Import Addresses panel showing the success state with the number of imported keys and the address group name. Include the Close button. -->

4. **Confirm your keys appear with the Imported state.** Back on the Keys page, look for your newly added keys in the table. They'll show a state of **Imported** — this means the system is evaluating each key against the chain to determine its actual state. This is a transient state that resolves automatically, usually within a few moments.

   ![Keys list showing Imported state](screenshots/step-04-keys-imported.png)
   <!-- Capture: The Keys table with one or more keys showing the Imported state badge. The State column should be prominently visible. -->

5. **Understand the key state badges.** As the Provider evaluates and operates your keys, they move through states automatically. Here's a quick reference for what each state means at a glance:

   | State | What it means |
   |-------|---------------|
   | **Imported** | Just added — system is checking it against the chain. Resolves automatically. |
   | **Available** | Confirmed unstaked and ready to be delivered to a delegator for staking. |
   | **Delivered** | Assigned to a delegator's Middleman. A staking transaction is expected soon. |
   | **Staking** | Staking transaction submitted to the chain and awaiting confirmation. |
   | **Staked** | Actively operating as a supplier. |
   | **Unstaking** | Unstake transaction submitted and awaiting confirmation. |
   | **Unstaked** | No longer staked — available for export or re-use. |
   | **Stake Failed** | Staking transaction failed. Operator action required. |
   | **Missing Stake** | Expected stake not found after 24 hours. Investigate with the delegator. |
   | **Remediation Failed** | Auto-remediation did not work. Use Mark for Remediation to retry. |
   | **Attention Needed** | System cannot auto-resolve this. Review the key details and take action. |

   > Keys progress through states automatically as staking operations proceed. See the [Key Management reference](../../reference/provider/key-management.md) for the full lifecycle diagram and all 11 state definitions.

   ![Key state badges in the table](screenshots/step-05-state-badges.png)
   <!-- Capture: The Keys table showing multiple keys in different states — ideally showing Imported, Available, Staked, and one error state badge together. -->

6. **Filter keys by state.** Use the **State** filter in the filter bar above the table to narrow the view to a specific lifecycle phase. For example, filtering to **Stake Failed** or **Attention Needed** quickly surfaces keys that need your attention, while filtering to **Staked** gives you a count of actively operating suppliers.

   ![State filter expanded](screenshots/step-06-filter-by-state.png)
   <!-- Capture: The Keys table with the State filter dropdown open, showing the list of available states. Include the filtered results in the background. -->

7. **Filter keys by address group.** Use the **Address Group** filter to narrow the view to keys belonging to a specific group. This is useful when you have multiple groups for different relay miners or services and want to audit a specific segment of your inventory.

   ![Address group filter](screenshots/step-07-filter-by-group.png)
   <!-- Capture: The Keys table with the Address Group filter active, showing only keys belonging to one group. The Address Group column should show the same group name across all visible rows. -->

8. **Export keys from a group.** Click **Export** in the top-right area. In the Export Addresses panel, select an **Address Group** and a **Key State** to filter which keys are included (e.g., export only `Available` keys). The panel shows how many keys match your selection. Click **Export Keys** — your browser downloads a JSON file named `{group-name}-keys-at-{timestamp}.json`. The exported file contains an array of objects with hex private keys.

   ![Export panel with group and state selected](screenshots/step-08-export-panel.png)
   <!-- Capture: The Export Addresses panel with an address group selected, a key state chosen, and the key count displayed. Include the Export Keys button. -->

---

You can now import, track, filter, and export keys in your Provider. Your key inventory is the foundation of your staking operations — keeping an eye on state badges and acting promptly on any **Stake Failed**, **Missing Stake**, or **Attention Needed** keys ensures your suppliers stay healthy.

**Next steps:**

- For the full key lifecycle diagram, all 11 state definitions, and remediation guidance, see the [Key Management reference](../../reference/provider/key-management.md).
- To understand how delegators deliver keys to your Provider, see the [How to onboard a new delegator](./onboard-delegator.md) guide.
