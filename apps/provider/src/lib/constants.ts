import { RPCType } from "@igniter/pocket/proto/pocket/shared/service";

export const labelByRpcType: Record<string, string> = {
  [RPCType.JSON_RPC]: "JSON_RPC",
  [RPCType.GRPC]: "GRPC",
  [RPCType.WEBSOCKET]: "WEBSOCKET",
  [RPCType.REST]: "REST",
}

export const validRpcTypes = [
  RPCType.JSON_RPC,
  RPCType.GRPC,
  RPCType.WEBSOCKET,
  RPCType.REST,
] as const;
