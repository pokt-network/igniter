import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureApplicationIsBootstrapped, validateRequestSignature, truncateIdentity } from '@/lib/utils/routes'
import { APIResponse } from '@/lib/models/response'
import { REQUEST_IDENTITY_HEADER } from '@igniter/commons/constants'
import {
  cancelPendingRequests,
  createImportRequest,
  findSuppliersByOwner,
} from '@/lib/dal/importSupplierRequests'
import { getLogger } from '@igniter/logger'
import { withLogging } from '@/lib/logging/withLogging'

const log = getLogger(['provider', 'import-suppliers'])

const importSuppliersRequestSchema = z.object({
  ownerAddress: z.string().min(1, 'ownerAddress is required'),
  excludeAddresses: z.array(z.string()).optional().default([]),
})

type ImportSuppliersRequestPayload = z.infer<typeof importSuppliersRequestSchema>

interface ImportSuppliersRequestResponse {
  nonce: string
  matchingSuppliers: number
  expiresAt: string
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
): Promise<NextResponse<APIResponse<ImportSuppliersRequestResponse | null>>> => {
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
      await validateRequestSignature<ImportSuppliersRequestPayload>(request)

    if (signatureValidationResponse instanceof NextResponse) {
      return signatureValidationResponse
    }

    // Validate request payload with Zod schema
    const parseResult = importSuppliersRequestSchema.safeParse(signatureValidationResponse.data)
    if (!parseResult.success) {
      log.debug('import suppliers request payload failed validation', { identity: truncateIdentity(delegatorIdentity), issues: parseResult.error.flatten() })
      return NextResponse.json(
        {
          error: `Invalid request: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        },
        { status: 400 },
      )
    }

    const data = parseResult.data

    // Cancel any existing pending requests for this owner+delegator
    const cancelledCount = await cancelPendingRequests(
      data.ownerAddress,
      delegatorIdentity,
    )

    // Find unassigned staked suppliers for this owner, excluding already-imported addresses
    const matchingSuppliers = await findSuppliersByOwner(
      data.ownerAddress,
      data.excludeAddresses,
    )

    if (matchingSuppliers.length === 0) {
      log.info('import suppliers request rejected', { ownerAddress: data.ownerAddress, identity: truncateIdentity(delegatorIdentity), cancelledCount, reason: 'no staked suppliers found' })
      return NextResponse.json(
        {
          error:
            'No staked suppliers found for this owner address.',
        },
        { status: 404 },
      )
    }

    // Create new import request
    const matchingAddresses = matchingSuppliers.map((s) => s.address)
    const importRequest = await createImportRequest(
      data.ownerAddress,
      delegatorIdentity,
      matchingAddresses,
    )

    log.info('import suppliers request created', { attemptId: importRequest.id, ownerAddress: data.ownerAddress, identity: truncateIdentity(delegatorIdentity), addressCount: matchingSuppliers.length, cancelledCount })

    return NextResponse.json(
      {
        data: {
          nonce: importRequest.nonce,
          matchingSuppliers: matchingSuppliers.length,
          expiresAt: importRequest.expiresAt.toISOString(),
        },
      },
      { status: 200 },
    )
  } catch (e) {
    log.error('import suppliers request failed', { error: e })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
