export const REQUEST_IDENTITY_HEADER = "X-Middleman-Identity";
export const REQUEST_SIGNATURE_HEADER = "X-Middleman-Signature";
export const STAKE_TYPE_URL = "/pocket.supplier.MsgStakeSupplier";
export const SEND_TYPE_URL = "/cosmos.bank.v1beta1.MsgSend";

export enum MessageType {
  Send = '/cosmos.bank.v1beta1.MsgSend',
  Stake = '/pocket.supplier.MsgStakeSupplier',
  Unstake = '/pocket.supplier.MsgUnstakeSupplier',
}
