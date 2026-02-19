import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureApplicationIsBootstrapped, validateRequestSignature } from '@/lib/utils/routes'
import { APIResponse } from '@/lib/models/response'
import { REQUEST_IDENTITY_HEADER } from '@/lib/constants'
import { findLatestRequest, isRequestExpired, markRequestExpired } from '@/lib/dal/importSupplierRequests'
import { ImportRequestStatus } from '@igniter/db/provider/enums'

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

export async function POST(
  request: Request,
): Promise<NextResponse<APIResponse<ImportSuppliersStatusResponse | null>>> {
  try {
    console.log('Received import suppliers status request')

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
      await validateRequestSignature<ImportSuppliersStatusPayload>(request)

    if (signatureValidationResponse instanceof NextResponse) {
      console.log('Signature validation failed. Exiting.')
      return signatureValidationResponse
    }

    console.log('Signature validation successful.')

    // Validate request payload with Zod schema
    const parseResult = importSuppliersStatusSchema.safeParse(signatureValidationResponse.data)
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

    // Find the latest request for this owner+delegator (optionally by nonce)
    const latestRequest = await findLatestRequest(
      data.ownerAddress,
      delegatorIdentity,
      data.nonce,
    )

    if (!latestRequest) {
      console.log('No import request found.')
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
    console.error('Error processing import suppliers status:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
