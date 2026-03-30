# Scenario 2: Setup Form — Dual URL Inputs

Verifies that both middleman and provider setup forms show two URL inputs and save correctly.

## Pre-conditions
- [ ] Fresh install OR existing install with migration applied
- [ ] Access to the admin setup page

## Steps

### 2.1 Provider Setup Form
- [ ] Navigate to provider admin setup → Blockchain Configuration step
- [ ] Verify TWO URL input fields are visible:
  - "Pocket API URL" (was previously labeled "RPC URL")
  - "Pocket RPC URL" (new field)
- [ ] Both fields are required (try submitting with one empty → error)

### 2.2 Test Presets (Provider)
- [ ] Click "Mainnet" preset button
  - [ ] API URL fills with `https://sauron-api.infra.pocket.network`
  - [ ] RPC URL fills with `https://sauron-rpc.infra.pocket.network`
- [ ] Click "Beta" preset button
  - [ ] API URL fills with `https://sauron-api.beta.infra.pocket.network`
  - [ ] RPC URL fills with `https://sauron-rpc.beta.infra.pocket.network`

### 2.3 API URL Validation
- [ ] Enter a valid API URL → blockchain params (chain ID, min stake, height) auto-detect
- [ ] Enter an invalid URL → error message shown
- [ ] Enter the RPC URL in the API field → validation fails (REST endpoints not available on RPC)

### 2.4 RPC URL Validation
- [ ] Enter a valid RPC URL → accepted (basic URL format check)
- [ ] Enter a non-URL → error message shown

### 2.5 Save and Verify
- [ ] Submit the form with valid API + RPC URLs
- [ ] Check DB:
```sql
SELECT "pocketApiUrl", "pocketRpcUrl" FROM application_settings LIMIT 1;
```
- [ ] Both values are saved correctly

### 2.6 Middleman Setup Form
- [ ] Repeat steps 2.1-2.5 for the middleman admin setup form
- [ ] Verify same dual-input behavior

### 2.7 Settings Page (Post-Setup)
- [ ] Navigate to Settings page (admin → settings)
- [ ] Verify both URLs are displayed and editable
- [ ] Change the RPC URL → save → verify DB updated

## Expected Result
Both apps show dual URL inputs, presets fill both, validation works, values persist to DB.
