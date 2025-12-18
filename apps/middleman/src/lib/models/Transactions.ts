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

export interface StakeTransactionSignaturePayload extends SupplierStake{
    ownerAddress: string;
    signer: string;
}

export interface OperationalFundsTransactionSignaturePayload {
    toAddress: string;
    amount: string;
}

export type TransactionMessage = StakeMessage | FundsMessage | UnstakeMessage;

export interface StakeMessage {
    typeUrl: '/pocket.supplier.MsgStakeSupplier';
    body: StakeTransactionSignaturePayload;
}

export interface UnstakeMessage {
    typeUrl: '/pocket.supplier.MsgUnstakeSupplier';
    body: UnstakeTransactionSignaturePayload;
}

export interface UnstakeTransactionSignaturePayload {
    signer: string;
    operatorAddress: string;
}

export interface FundsMessage {
    typeUrl: '/cosmos.bank.v1beta1.MsgSend';
    body: OperationalFundsTransactionSignaturePayload;
}

export interface SignedTransaction {
    address: string;
    signedPayload: string;
    unsignedPayload: string;
    estimatedFee: number,
    signature: string;
}

export interface SignedMemoPayload {
  i: string;
  a: string;
  f: string;
}

export interface SignedMemo extends SignedMemoPayload {
  s: string;
}
