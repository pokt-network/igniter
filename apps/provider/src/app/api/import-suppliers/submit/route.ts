import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureApplicationIsBootstrapped, validateRequestSignature } from '@/lib/utils/routes'
import { APIResponse } from '@/lib/models/response'
import { REQUEST_IDENTITY_HEADER } from '@/lib/constants'
import { pubkeyToAddress, verifySignature } from '@/lib/crypto'
import {
  assignSuppliersToDelegate,
  findPendingRequest,
  findSuppliersByOwner,
  isRequestExpired,
  markRequestCompleted,
  markRequestExpired,
  markRequestFailed,
} from '@/lib/dal/importSupplierRequests'

const importSuppliersSubmitSchema = z.object({
  ownerAddress: z.string().min(1, 'ownerAddress is required'),
  ownerPublicKey: z.string().length(66, 'ownerPublicKey must be 66 hex characters (33-byte compressed)'),
  signedNonce: z.string().min(1, 'signedNonce is required'), // hex signature
  delegatorAddress: z.string().min(1, 'delegatorAddress is required'), // middleman rewards address
  revSharePercentage: z.number().min(0).max(100),
})

type ImportSuppliersSubmitPayload = z.infer<typeof importSuppliersSubmitSchema>

interface ImportedSupplier {
  address: string
  publicKey: string
  stakeAmount: string
  services: Array<{
    serviceId: string
    endpoints: Array<{
      url: string
      rpcType: number
    }>
  }>
}

interface ImportSuppliersSubmitResponse {
  importedSuppliers: ImportedSupplier[]
  totalImported: number
}

export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    },
  )
}

export async function POST(
  request: Request,
): Promise<NextResponse<APIResponse<ImportSuppliersSubmitResponse | null>>> {
  try {
    console.log('Received import suppliers submit request')

    const isBootstrappedResponse = await ensureApplicationIsBootstrapped()
    if (isBootstrappedResponse instanceof NextResponse) {
      console.log('Application is not bootstrapped. Exiting.')
      return isBootstrappedResponse
    }

    const delegatorIdentity = request.headers.get(REQUEST_IDENTITY_HEADER)
    if (!delegatorIdentity) {
      console.log('Invalid request. Delegator identity was not provided.')
      return NextResponse.json(
        {
          error: `Invalid request. Delegator identity was not provided. ${REQUEST_IDENTITY_HEADER} is required.`,
        },
        { status: 400 },
      )
    }

    console.log('Validating signature...')
    const signatureValidationResponse =
      await validateRequestSignature<ImportSuppliersSubmitPayload>(request)

    if (signatureValidationResponse instanceof NextResponse) {
      console.log('Signature validation failed. Exiting.')
      return signatureValidationResponse
    }

    console.log('Signature validation successful.')

    // Validate request payload with Zod schema
    const parseResult = importSuppliersSubmitSchema.safeParse(signatureValidationResponse.data)
    if (!parseResult.success) {
      console.log('Invalid request payload:', parseResult.error.flatten())
      return NextResponse.json(
        {
          error: `Invalid request: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        },
        { status: 400 },
      )
    }

    const data = parseResult.data

    // Find pending request for this owner+delegator
    const pendingRequest = await findPendingRequest(
      data.ownerAddress,
      delegatorIdentity,
    )

    if (!pendingRequest) {
      console.log(`No pending import request found for ${data.ownerAddress} and ${delegatorIdentity}.`)
      return NextResponse.json(
        { error: 'No pending import request found. Please initiate a new request.' },
        { status: 404 },
      )
    }

    // Check if request has expired
    if (isRequestExpired(pendingRequest)) {
      console.log(`Import request for ${data.ownerAddress} and ${delegatorIdentity} has expired.`)
      await markRequestExpired(pendingRequest.id)
      return NextResponse.json(
        { error: 'Import request has expired. Please initiate a new request.' },
        { status: 410 },
      )
    }

    // Verify that the public key matches the owner address
    let derivedAddress: string
    try {
      // Public key is already in hex format (66 chars = 33 bytes compressed)
      derivedAddress = pubkeyToAddress(data.ownerPublicKey)
    } catch (e) {
      console.error(`Failed to derive address from public key ${data.ownerPublicKey}:`, e)
      await markRequestFailed(pendingRequest.id, 'Invalid public key format')
      return NextResponse.json(
        { error: 'Invalid public key format.' },
        { status: 400 },
      )
    }

    if (derivedAddress !== data.ownerAddress) {
      console.log(
        `Public key does not match owner address. Derived: ${derivedAddress}, Expected: ${data.ownerAddress}`,
      )
      await markRequestFailed(
        pendingRequest.id,
        'Public key does not match owner address',
      )
      return NextResponse.json(
        { error: 'Public key does not match owner address.' },
        { status: 403 },
      )
    }

    // Verify the signature of the nonce
    const isValidSignature = await verifySignature(
      pendingRequest.nonce,
      data.ownerPublicKey,
      data.signedNonce,
      'hex',
    )

    if (!isValidSignature) {
      console.log(`Invalid nonce signature for ${data.ownerAddress} and ${delegatorIdentity}.`)
      await markRequestFailed(pendingRequest.id, 'Invalid nonce signature')
      return NextResponse.json(
        { error: 'Invalid signature. Nonce signature verification failed.' },
        { status: 403 },
      )
    }

    console.log(`Nonce signature verified successfully for ${data.ownerAddress} and ${delegatorIdentity}.`)

    // Get the matching suppliers again to ensure they're still unassigned
    const matchingSuppliers = await findSuppliersByOwner(data.ownerAddress)

    if (matchingSuppliers.length === 0) {
      console.log(`No unassigned suppliers found for ${data.ownerAddress} and ${delegatorIdentity}.`)
      await markRequestFailed(pendingRequest.id, 'No suppliers available to import')
      return NextResponse.json(
        { error: 'No unassigned suppliers available for import.' },
        { status: 404 },
      )
    }

    // Assign suppliers to the delegator
    const supplierAddresses = matchingSuppliers.map((s) => s.address)
    const assignedSuppliers = await assignSuppliersToDelegate(
      supplierAddresses,
      delegatorIdentity,
      data.revSharePercentage,
      data.delegatorAddress,
    )

    console.log(`Assigned ${assignedSuppliers.length} suppliers for ${data.ownerAddress} and ${delegatorIdentity}.`)

    // Mark request as completed
    await markRequestCompleted(pendingRequest.id)

    // Build response with supplier details
    const importedSuppliers: ImportedSupplier[] = assignedSuppliers.map((s) => ({
      address: s.address,
      publicKey: s.publicKey,
      stakeAmount: (s.stakeAmountUpokt ?? 0).toString(),
      services: (s.services || []).map((svc) => ({
        serviceId: svc.serviceId,
        endpoints: svc.endpoints.map((ep: { url: string; rpcType: number }) => ({
          url: ep.url,
          rpcType: ep.rpcType,
        })),
      })),
    }))

    return NextResponse.json(
      {
        data: {
          importedSuppliers,
          totalImported: importedSuppliers.length,
        },
      },
      { status: 200 },
    )
  } catch (e) {
    console.error('Error processing import suppliers submit:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
