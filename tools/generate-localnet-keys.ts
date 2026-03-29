import * as fs from 'fs'
import * as path from 'path'
import { Secp256k1, Random, sha256 } from '@cosmjs/crypto'
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing'

const PROJECT_ROOT = path.resolve(__dirname, '..')
const ALL_KEYS_PATH = path.join(PROJECT_ROOT, 'k8s/tools/localnet/config/all-keys.yaml')
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'k8s/tools/localnet/localnet-keys.json')

const OWNER_NAMES = new Set(['faucet', 'pnf', 'source_owner_develop'])
const SKIP_NAMES = new Set(['supplier16_fake_app1', 'supplier17_fake_app2'])
const GATEWAY_NAMES = new Set(['gateway1'])
const SUPPLIER_PATTERN = /^supplier\d+$/

interface KeyEntry {
  name: string
  address: string
  privateKey: string
}

interface ParsedAccount {
  name: string
  address: string
  private_key: string
}

function parseAllKeysYaml(content: string): ParsedAccount[] {
  const accounts: ParsedAccount[] = []
  const lines = content.split('\n')

  let current: Partial<ParsedAccount> | null = null

  for (const line of lines) {
    const nameMatch = line.match(/^\s*-\s*name:\s*(\S+)/)
    if (nameMatch) {
      if (current && current.name && current.address && current.private_key) {
        accounts.push(current as ParsedAccount)
      }
      current = { name: nameMatch[1] }
      continue
    }

    if (!current) continue

    const addressMatch = line.match(/^\s+address:\s*(\S+)/)
    if (addressMatch) {
      current.address = addressMatch[1]
      continue
    }

    const keyMatch = line.match(/^\s+private_key:\s*(\S+)/)
    if (keyMatch) {
      current.private_key = keyMatch[1]
      continue
    }
  }

  // Push the last account
  if (current && current.name && current.address && current.private_key) {
    accounts.push(current as ParsedAccount)
  }

  return accounts
}

function categorizeAccounts(accounts: ParsedAccount[]): {
  owners: KeyEntry[]
  suppliers_staked: KeyEntry[]
  gateway: KeyEntry[]
} {
  const owners: KeyEntry[] = []
  const suppliers_staked: KeyEntry[] = []
  const gateway: KeyEntry[] = []

  for (const account of accounts) {
    if (SKIP_NAMES.has(account.name)) continue

    const entry: KeyEntry = {
      name: account.name,
      address: account.address,
      privateKey: account.private_key,
    }

    if (OWNER_NAMES.has(account.name)) {
      owners.push(entry)
    } else if (GATEWAY_NAMES.has(account.name)) {
      gateway.push(entry)
    } else if (SUPPLIER_PATTERN.test(account.name)) {
      suppliers_staked.push(entry)
    }
  }

  return { owners, suppliers_staked, gateway }
}

async function generateFreeKeys(count: number): Promise<KeyEntry[]> {
  const keys: KeyEntry[] = []

  for (let i = 1; i <= count; i++) {
    const privKeyBytes = Random.getBytes(32)
    const wallet = await DirectSecp256k1Wallet.fromKey(privKeyBytes, 'pokt')
    const [account] = await wallet.getAccounts()

    keys.push({
      name: `free-${i}`,
      address: account.address,
      privateKey: Buffer.from(privKeyBytes).toString('hex'),
    })
  }

  return keys
}

async function main() {
  // Read and parse all-keys.yaml
  if (!fs.existsSync(ALL_KEYS_PATH)) {
    throw new Error(`all-keys.yaml not found at ${ALL_KEYS_PATH}`)
  }

  const yamlContent = fs.readFileSync(ALL_KEYS_PATH, 'utf-8')
  const accounts = parseAllKeysYaml(yamlContent)

  console.log(`Parsed ${accounts.length} accounts from all-keys.yaml`)

  // Categorize existing accounts
  const { owners, suppliers_staked, gateway } = categorizeAccounts(accounts)

  console.log(`  owners: ${owners.length}`)
  console.log(`  suppliers_staked: ${suppliers_staked.length}`)
  console.log(`  gateway: ${gateway.length}`)

  // Generate 50 fresh keys
  console.log('Generating 50 fresh secp256k1 keys...')
  const free = await generateFreeKeys(50)

  // Build import_ready array (only free keys' private key hex strings)
  const import_ready = free.map((k) => k.privateKey)

  // Build output
  const output = {
    owners,
    suppliers_staked,
    gateway,
    free,
    import_ready,
  }

  // Write output
  const outputDir = path.dirname(OUTPUT_PATH)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n')
  console.log(`\nWrote ${OUTPUT_PATH}`)
  console.log(`  ${free.length} free keys generated`)
  console.log(`  ${import_ready.length} keys in import_ready array`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
