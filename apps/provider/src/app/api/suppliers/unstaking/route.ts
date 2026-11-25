import { NextResponse } from 'next/server'
import { ensureApplicationIsBootstrapped, validateRequestSignature, truncateIdentity } from '@/lib/utils/routes'
import { MAX_SUPPLIERS_PER_REQUEST, SupplierMarkStakedRequest } from '@/lib/models/supplier'
import { listAddressesDeliveredTo } from '@/lib/dal/keys'
import { APIResponse } from '@/lib/models/response'
import { REQUEST_IDENTITY_HEADER } from '@igniter/commons/constants'
import { getTemporalClient, getTemporalConfig } from '@/lib/temporal'
import { randomUUID } from 'crypto'
import { getLogger } from '@igniter/logger'
import { withLogging } from '@/lib/logging/withLogging'

const log = getLogger(['provider', 'suppliers'])

export async function OPTIONS() {
  return NextResponse.json({}, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

export const POST = withLogging(async (request: Request): Promise<NextResponse<APIResponse<'OK' | null>>> => {
  try {
    const isBootstrappedResponse = await ensureApplicationIsBootstrapped()

    if (isBootstrappedResponse instanceof NextResponse) {
      return isBootstrappedResponse
    }

    const delegatorIdentity = request.headers.get(REQUEST_IDENTITY_HEADER)

    if (!delegatorIdentity) {
      return NextResponse.json({ error: `Invalid request. Delegator identity was not provided. REQUEST_IDENTITY_HEADER: ${REQUEST_IDENTITY_HEADER} is required.` }, { status: 400 })
    }

    const signatureValidationResponse = await validateRequestSignature<SupplierMarkStakedRequest>(request)

    if (signatureValidationResponse instanceof NextResponse) {
      return signatureValidationResponse
    }

    const { data, delegator } = signatureValidationResponse

    if (!data || !Array.isArray(data.addresses) || !data.addresses.length) {
      return NextResponse.json({ error: 'Invalid request. Empty suppliers list.' }, { status: 400 })
    }

    if (data.addresses.length > MAX_SUPPLIERS_PER_REQUEST) {
      return NextResponse.json({ error: `Invalid request. At most ${MAX_SUPPLIERS_PER_REQUEST} suppliers per request.` }, { status: 400 })
    }

    // Only the suppliers delivered to the calling delegator.
    const addresses = await listAddressesDeliveredTo(data.addresses, delegator!.identity)

    if (addresses.length === 0) {
      return NextResponse.json({ error: 'Invalid request. None of the suppliers belong to this delegator.' }, { status: 400 })
    }

    const { taskQueue } = getTemporalConfig()
    const client = getTemporalClient()

    const workflowId = `SSA-${randomUUID()}`
    log.info('supplier unstaking verification requested', { supplierAddresses: addresses, identity: truncateIdentity(delegatorIdentity), workflowId })
    await client.workflow.start('SupplierStatusForAddresses', {
      taskQueue,
      workflowId,
      args: [{ addresses }],
    })

    return NextResponse.json({ data: 'OK' }, { status: 200 })
  } catch (e) {
    log.error('supplier unstaking request failed', { error: e })
    return NextResponse.json({ error: 'Invalid request' }, { status: 500 })
  }
})
