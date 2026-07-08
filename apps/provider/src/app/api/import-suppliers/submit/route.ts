import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureApplicationIsBootstrapped, validateRequestSignature } from '@/lib/utils/routes'
import { APIResponse } from '@/lib/models/response'
import { REQUEST_IDENTITY_HEADER } from '@igniter/commons/constants'
import { pubkeyToAddress, verifySignature } from '@igniter/commons/crypto'
import { verifyAdr36Signature } from '@/lib/adr36'
import {
  assignSuppliersToDelegate,
  findPendingRequest,
  findSuppliersByOwner,
  isRequestExpired,
  markRequestCompleted,
  markRequestExpired,
  markRequestFailed,
} from '@/lib/dal/importSupplierRequests'
import { getLogger } from '@igniter/logger'
import { withLogging } from '@/lib/logging/withLogging'

const log = getLogger(['provider', 'import-suppliers'])

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

export const POST = withLogging(async (
  request: Request,
): Promise<NextResponse<APIResponse<ImportSuppliersSubmitResponse | null>>> => {
  try {
    const isBootstrappedResponse = await ensureApplicationIsBootstrapped()
    if (isBootstrappedResponse instanceof NextResponse) {
      return isBootstrappedResponse
    }

    const delegatorIdentity = request.headers.get(REQUEST_IDENTITY_HEADER)
    if (!delegatorIdentity) {
      return NextResponse.json(
        {
          error: `Invalid request. Delegator identity was not provided. ${REQUEST_IDENTITY_HEADER} is required.`,
        },
        { status: 400 },
      )
    }

    const signatureValidationResponse =
      await validateRequestSignature<ImportSuppliersSubmitPayload>(request)

    if (signatureValidationResponse instanceof NextResponse) {
      return signatureValidationResponse
    }

    // Validate request payload with Zod schema
    const parseResult = importSuppliersSubmitSchema.safeParse(signatureValidationResponse.data)
    if (!parseResult.success) {
      log.debug('import suppliers submit payload failed validation', { delegatorIdentity, issues: parseResult.error.flatten() })
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
      log.info('import suppliers submit rejected', { ownerAddress: data.ownerAddress, delegatorIdentity, reason: 'no pending request' })
      return NextResponse.json(
        { error: 'No pending import request found. Please initiate a new request.' },
        { status: 404 },
      )
    }

    const attemptId = pendingRequest.id

    // Check if request has expired
    if (isRequestExpired(pendingRequest)) {
      log.info('import suppliers submit rejected', { attemptId, ownerAddress: data.ownerAddress, delegatorIdentity, reason: 'expired' })
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
      log.error('failed to derive address from public key', { attemptId, ownerAddress: data.ownerAddress, delegatorIdentity, error: e })
      await markRequestFailed(pendingRequest.id, 'Invalid public key format')
      return NextResponse.json(
        { error: 'Invalid public key format.' },
        { status: 400 },
      )
    }

    if (derivedAddress !== data.ownerAddress) {
      log.info('import suppliers submit rejected', { attemptId, ownerAddress: data.ownerAddress, delegatorIdentity, reason: 'public key does not match owner address' })
      await markRequestFailed(
        pendingRequest.id,
        'Public key does not match owner address',
      )
      return NextResponse.json(
        { error: 'Public key does not match owner address.' },
        { status: 403 },
      )
    }

    // Verify the signature of the nonce (try raw signature first, then ADR-36 for Keplr)
    let isValidSignature = await verifySignature(
      pendingRequest.nonce,
      data.ownerPublicKey,
      data.signedNonce,
      'hex',
    )

    if (!isValidSignature) {
      isValidSignature = await verifyAdr36Signature(
        pendingRequest.nonce,
        data.ownerAddress,
        data.ownerPublicKey,
        data.signedNonce,
      )
    }

    if (!isValidSignature) {
      log.info('import suppliers submit rejected', { attemptId, ownerAddress: data.ownerAddress, delegatorIdentity, reason: 'invalid nonce signature' })
      await markRequestFailed(pendingRequest.id, 'Invalid nonce signature')
      return NextResponse.json(
        { error: 'Invalid signature. Nonce signature verification failed.' },
        { status: 403 },
      )
    }

    // Get the matching suppliers again to ensure they're still unassigned
    const matchingSuppliers = await findSuppliersByOwner(data.ownerAddress)

    if (matchingSuppliers.length === 0) {
      log.info('import suppliers submit rejected', { attemptId, ownerAddress: data.ownerAddress, delegatorIdentity, reason: 'no unassigned suppliers' })
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

    // Mark request as completed
    await markRequestCompleted(pendingRequest.id)

    log.info('suppliers imported', { attemptId, ownerAddress: data.ownerAddress, delegatorIdentity, addressCount: assignedSuppliers.length })

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
    log.error('import suppliers submit failed', { error: e })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
