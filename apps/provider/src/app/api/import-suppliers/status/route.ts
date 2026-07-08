import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureApplicationIsBootstrapped, validateRequestSignature, truncateIdentity } from '@/lib/utils/routes'
import { APIResponse } from '@/lib/models/response'
import { REQUEST_IDENTITY_HEADER } from '@igniter/commons/constants'
import { findLatestRequest, isRequestExpired, markRequestExpired } from '@/lib/dal/importSupplierRequests'
import { ImportRequestStatus } from '@igniter/db/provider/enums'
import { getLogger } from '@igniter/logger'
import { withLogging } from '@/lib/logging/withLogging'

const log = getLogger(['provider', 'import-suppliers'])

const importSuppliersStatusSchema = z.object({
  ownerAddress: z.string().min(1, 'ownerAddress is required'),
  nonce: z.string().optional(),
})

type ImportSuppliersStatusPayload = z.infer<typeof importSuppliersStatusSchema>

interface ImportSuppliersStatusResponse {
  status: ImportRequestStatus
  importedSupplierAddresses?: string[]
  errorMessage?: string
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
): Promise<NextResponse<APIResponse<ImportSuppliersStatusResponse | null>>> => {
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
      await validateRequestSignature<ImportSuppliersStatusPayload>(request)

    if (signatureValidationResponse instanceof NextResponse) {
      return signatureValidationResponse
    }

    // Validate request payload with Zod schema
    const parseResult = importSuppliersStatusSchema.safeParse(signatureValidationResponse.data)
    if (!parseResult.success) {
      log.debug('import suppliers status payload failed validation', { identity: truncateIdentity(delegatorIdentity), issues: parseResult.error.flatten() })
      return NextResponse.json(
        {
          error: `Invalid request: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        },
        { status: 400 },
      )
    }

    const data = parseResult.data

    // Find the latest request for this owner+delegator (optionally by nonce)
    const latestRequest = await findLatestRequest(
      data.ownerAddress,
      delegatorIdentity,
      data.nonce,
    )

    if (!latestRequest) {
      log.debug('import suppliers status: no request found', { ownerAddress: data.ownerAddress, identity: truncateIdentity(delegatorIdentity) })
      return NextResponse.json(
        { error: 'No import request found for this owner address.' },
        { status: 404 },
      )
    }

    // If pending and expired, mark it as expired
    if (
      latestRequest.status === ImportRequestStatus.Pending &&
      isRequestExpired(latestRequest)
    ) {
      await markRequestExpired(latestRequest.id)
      return NextResponse.json(
        {
          data: {
            status: ImportRequestStatus.Expired,
          },
        },
        { status: 200 },
      )
    }

    // Build response
    const response: ImportSuppliersStatusResponse = {
      status: latestRequest.status,
    }

    if (latestRequest.status === ImportRequestStatus.Completed) {
      response.importedSupplierAddresses =
        latestRequest.matchingSupplierAddresses || []
    }

    if (latestRequest.errorMessage) {
      response.errorMessage = latestRequest.errorMessage
    }

    return NextResponse.json({ data: response }, { status: 200 })
  } catch (e) {
    log.error('import suppliers status check failed', { error: e })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
