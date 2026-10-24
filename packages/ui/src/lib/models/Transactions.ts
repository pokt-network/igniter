export interface SupplierStake {
    operatorAddress: string;
    stakeAmount: string;
    services: {
        serviceId: string;
        revShare: {
            address: string;
            revSharePercentage: number;
        }[];
        endpoints: {
            url: string;
            rpcType: string;
            configs: { key: number; value: string; }[],
        }[];
    }[];
}

export interface StakeTransactionSignaturePayload extends SupplierStake {
  ownerAddress: string;
  signer: string;
}

export interface UnstakeTransactionSignaturePayload {
  signer: string;
  operatorAddress: string;
}

export interface OperationalFundsTransactionSignaturePayload {
  toAddress: string;
  amount: string;
}

export type TransactionMessage =
  | StakeMessage
  | FundsMessage
  | UnstakeMessage
  | DelegateMessage
  | UndelegateMessage
  | RedelegateMessage
  | WithdrawRewardMessage;

export interface StakeMessage {
  typeUrl: '/pocket.supplier.MsgStakeSupplier';
  body: StakeTransactionSignaturePayload;
}

export interface UnstakeMessage {
  typeUrl: '/pocket.supplier.MsgUnstakeSupplier';
  body: UnstakeTransactionSignaturePayload;
}

export interface FundsMessage {
  typeUrl: '/cosmos.bank.v1beta1.MsgSend';
  body: OperationalFundsTransactionSignaturePayload;
}

/** Cosmos staking / distribution messages. `amount` is an upokt integer string. */
export interface DelegateMessage {
  typeUrl: '/cosmos.staking.v1beta1.MsgDelegate';
  body: { delegatorAddress: string; validatorAddress: string; amount: string };
}

export interface UndelegateMessage {
  typeUrl: '/cosmos.staking.v1beta1.MsgUndelegate';
  body: { delegatorAddress: string; validatorAddress: string; amount: string };
}

export interface RedelegateMessage {
  typeUrl: '/cosmos.staking.v1beta1.MsgBeginRedelegate';
  body: { delegatorAddress: string; validatorSrcAddress: string; validatorDstAddress: string; amount: string };
}

export interface WithdrawRewardMessage {
  typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward';
  body: { delegatorAddress: string; validatorAddress: string };
}

export interface SignedTransaction {
  address: string;
  signedPayload: string;
  unsignedPayload: string;
  estimatedFee: number,
  signature: string;
}

export interface SignedMemoPayload {
  t: string;
  a: string;
  f: string;
}

export interface SignedMemo extends SignedMemoPayload {
  s: string;
  p: string;
}
