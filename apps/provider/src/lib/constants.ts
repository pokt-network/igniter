import { RPCType } from "@igniter/pocket/proto/pocket/shared/service"
import type { NotificationEventType } from '@igniter/db/provider/schema'

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  keys_staked: 'Suppliers Staked',
  keys_unstaked: 'Suppliers Unstaked',
  supplier_funds_low: 'Supplier Funds Low',
  supplier_stake_low: 'Supplier Stake Low',
  remediation_summary: 'Remediation Complete',
  delegators_synced: 'Delegators Synced',
}

export const NOTIFICATION_EVENT_GRADIENT: Record<NotificationEventType, string> = {
  keys_staked: 'gradient-border-green',
  keys_unstaked: 'gradient-border-orange',
  supplier_funds_low: 'gradient-border-orange',
  supplier_stake_low: 'gradient-border-orange',
  remediation_summary: 'gradient-border-purple',
  delegators_synced: 'gradient-border-slate',
}

export const NOTIFICATION_EVENT_SEVERITY: Record<NotificationEventType, 'info' | 'warning' | 'error' | 'success'> = {
  keys_staked: 'success',
  keys_unstaked: 'warning',
  supplier_funds_low: 'warning',
  supplier_stake_low: 'error',
  remediation_summary: 'info',
  delegators_synced: 'info',
}

export const REMEDIATION_REASON_LABELS: Record<string, string> = {
  '1001': 'Service Mismatch',
  '1002': 'Delegator Address Missing',
  '1003': 'Owner Initial Stake',
  '1004': 'Stake Too Low',
  '1005': 'Funds Too Low',
  '1006': 'Address Group Migration',
}

export const labelByRpcType: Record<string, string> = {
  [RPCType.JSON_RPC]: "JSON_RPC",
  [RPCType.GRPC]: "GRPC",
  [RPCType.WEBSOCKET]: "WEBSOCKET",
  [RPCType.REST]: "REST",
  [RPCType.COMET_BFT]: "COMET_BFT",
}

export const validRpcTypes = [
  RPCType.JSON_RPC,
  RPCType.GRPC,
  RPCType.WEBSOCKET,
  RPCType.REST,
  RPCType.COMET_BFT,
] as const;
