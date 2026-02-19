export type ImportStageStatus = 'pending' | 'success' | 'error'

export enum ImportSuppliersStep {
  OwnerAddress = 'OwnerAddress',
  SelectProvider = 'SelectProvider',
  ImportProcess = 'ImportProcess',
  Success = 'Success',
}

export interface ImportProcessStatus {
  requestImportStatus: ImportStageStatus
  signNonceStatus: ImportStageStatus
  submitImportStatus: ImportStageStatus
}

export interface ProviderOption {
  id: number
  identity: string
  name: string
}
