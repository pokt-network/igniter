import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureApplicationIsBootstrapped, validateRequestSignature } from '@/lib/utils/routes'
import { APIResponse } from '@/lib/models/response'
import { REQUEST_IDENTITY_HEADER } from '@igniter/commons/constants'
import {
  cancelPendingRequests,
  createImportRequest,
  findSuppliersByOwner,
} from '@/lib/dal/importSupplierRequests'

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

export async function POST(
  request: Request,
): Promise<NextResponse<APIResponse<ImportSuppliersRequestResponse | null>>> {
  try {
    console.log('Received import suppliers request')

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
      await validateRequestSignature<ImportSuppliersRequestPayload>(request)

    if (signatureValidationResponse instanceof NextResponse) {
      console.log('Signature validation failed. Exiting.')
      return signatureValidationResponse
    }

    console.log('Signature validation successful from request.')

    // Validate request payload with Zod schema
    const parseResult = importSuppliersRequestSchema.safeParse(signatureValidationResponse.data)
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

    // Cancel any existing pending requests for this owner+delegator
    const cancelledCount = await cancelPendingRequests(
      data.ownerAddress,
      delegatorIdentity,
    )
    if (cancelledCount > 0) {
      console.log(`Cancelled ${cancelledCount} existing pending request(s) for ${data.ownerAddress} and ${delegatorIdentity}.`)
    }

    // Find unassigned staked suppliers for this owner, excluding already-imported addresses
    const matchingSuppliers = await findSuppliersByOwner(
      data.ownerAddress,
      data.excludeAddresses,
    )

    if (matchingSuppliers.length === 0) {
      console.log(`No staked suppliers found for owner ${data.ownerAddress}.`)
      return NextResponse.json(
        {
          error:
            'No staked suppliers found for this owner address.',
        },
        { status: 404 },
      )
    }

    console.log(`Found ${matchingSuppliers.length} matching suppliers for ${data.ownerAddress}`)

    // Create new import request
    const matchingAddresses = matchingSuppliers.map((s) => s.address)
    const importRequest = await createImportRequest(
      data.ownerAddress,
      delegatorIdentity,
      matchingAddresses,
    )

    console.log(
      `Created import request for ${data.ownerAddress} and ${delegatorIdentity} with nonce: ${importRequest.nonce.substring(0, 8)}...`,
    )

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
    console.error('Error processing import suppliers request:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
