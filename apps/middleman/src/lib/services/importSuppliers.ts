/**
 * Service for importing suppliers from a provider.
 * Uses the provider-rpc route to communicate with the provider's import endpoints.
 */

export interface ImportRequestResponse {
  nonce: string
  matchingSuppliers: number
  expiresAt: string
}

export interface ImportedSupplier {
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

export interface ImportSubmitResponse {
  importedSuppliers: ImportedSupplier[]
  totalImported: number
}

export interface ImportStatusResponse {
  status: string
  importedSupplierAddresses?: string[]
  errorMessage?: string
}

/**
 * Requests to initiate an import of suppliers from a provider.
 * Returns a nonce that must be signed by the owner wallet.
 *
 * @param providerIdentity - The identity of the provider to import from
 * @param ownerAddress - The owner address whose suppliers to import
 * @returns The nonce, matching supplier count, and expiry time
 */
export async function requestImportSuppliers(
  providerIdentity: string,
  ownerAddress: string,
  excludeAddresses: string[] = [],
): Promise<ImportRequestResponse> {
  const response = await fetch('/api/provider-rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: providerIdentity,
      path: '/api/import-suppliers/request',
      data: {
        ownerAddress,
        excludeAddresses,
      },
    }),
  })

  const responseBody = await response.json()

  if (responseBody.error) {
    throw new Error(responseBody.error)
  }

  return responseBody.data
}

/**
 * Submits the signed nonce to complete the import process.
 *
 * @param providerIdentity - The identity of the provider
 * @param ownerAddress - The owner address
 * @param ownerPublicKey - The owner's compressed public key (base64)
 * @param signedNonce - The signed nonce (base64)
 * @param delegatorAddress - The middleman's rewards address
 * @param revSharePercentage - The revenue share percentage
 * @returns The list of imported suppliers
 */
export async function submitImportSuppliers(
  providerIdentity: string,
  ownerAddress: string,
  ownerPublicKey: string,
  signedNonce: string,
  delegatorAddress: string,
  revSharePercentage: number,
): Promise<ImportSubmitResponse> {
  const response = await fetch('/api/provider-rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: providerIdentity,
      path: '/api/import-suppliers/submit',
      data: {
        ownerAddress,
        ownerPublicKey,
        signedNonce,
        delegatorAddress,
        revSharePercentage,
      },
    }),
  })

  const responseBody = await response.json()

  if (responseBody.error) {
    throw new Error(responseBody.error)
  }

  return responseBody.data
}

/**
 * Checks the status of an import request.
 * Used for recovery when a request may have completed on the provider side
 * but the middleman didn't receive the response.
 *
 * @param providerIdentity - The identity of the provider
 * @param ownerAddress - The owner address
 * @param nonce - Optional nonce to check a specific request
 * @returns The status of the import request
 */
export async function checkImportStatus(
  providerIdentity: string,
  ownerAddress: string,
  nonce?: string,
): Promise<ImportStatusResponse> {
  const response = await fetch('/api/provider-rpc', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: providerIdentity,
      path: '/api/import-suppliers/status',
      data: {
        ownerAddress,
        ...(nonce && { nonce }),
      },
    }),
  })

  const responseBody = await response.json()

  if (responseBody.error) {
    throw new Error(responseBody.error)
  }

  return responseBody.data
}
