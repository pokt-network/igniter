export const STAKE_TYPE_URL = "/pocket.supplier.MsgStakeSupplier";
export const UNSTAKE_TYPE_URL = "/pocket.supplier.MsgUnstakeSupplier";
export const SEND_TYPE_URL = "/cosmos.bank.v1beta1.MsgSend";

export interface NewStake {
  address: string;
  ownerAddress: string;
  stakeAmount: string;
  balance: number;
  services: StakeOperation['value']['services'];
  opFundsUpokt: string | null;
}

export interface NewUnstake {
  // owner address
  signer: string;
  operatorAddress: string;
}

export interface SendOperation {
  typeUrl: typeof SEND_TYPE_URL;
  value: {
    fromAddress: string
    toAddress: string
    amount: Array<{
      denom: string
      amount: number
    }>
  }
}

export interface StakeOperation {
  typeUrl: typeof STAKE_TYPE_URL;
  value: {
    signer: string
    ownerAddress: string
    operatorAddress: string
    stake: {
      denom: string
      amount: number
    }
    services: Array<{
      serviceId: string
      endpoints: Array<{
        url: string
        rpcType: string
        configs: Array<{
          key: string
          value: string
        }>
      }>
      revShare: Array<{
        address: string
        revSharePercentage: string
      }>
    }>
  }
}

export interface UnstakeOperation {
  typeUrl: typeof UNSTAKE_TYPE_URL;
  value: {
    signer: string
    operatorAddress: string
  }
}

export function extractTransactionStakingSuppliers(tx: { unsignedPayload: string }): NewStake[] {
  try {
    const {body} = JSON.parse(tx.unsignedPayload);
    const messages: Array<StakeOperation | SendOperation> = body.messages;

    // Build a map of operatorAddress → op funds amount from MsgSend messages
    const opFundsMap: Record<string, string> = {};
    for (const msg of messages) {
      if (msg.typeUrl === SEND_TYPE_URL) {
        const send = msg as SendOperation;
        // We'll match sends by toAddress after we know the operator addresses
        // Store all sends keyed by toAddress for later lookup
        const coin = send.value.amount[0];
        if (coin) {
          opFundsMap[send.value.toAddress] = coin.amount.toString();
        }
      }
    }

    const nodes: Record<string, NewStake> = messages.reduce((nodes: Record<string, NewStake>, message) => {
      if (message.typeUrl === STAKE_TYPE_URL) {
        const stakeMsg = message as StakeOperation;
        const {stake, operatorAddress, ownerAddress, services} = stakeMsg.value;
        nodes[operatorAddress] = {
          address: operatorAddress,
          ownerAddress,
          stakeAmount: stake.amount.toString(),
          balance: nodes[operatorAddress]?.balance || 0,
          services,
          opFundsUpokt: opFundsMap[operatorAddress] ?? null,
        };
      }

      return nodes;
    }, {});

    return Object.values(nodes);
  } catch (err) {
    console.log("Something went wrong while parsing the transaction to extract the staked nodes information.");
    console.error(err);
    return [];
  }
}

export function extractTransactionUnstakingSuppliers(tx: { unsignedPayload: string }): Array<NewUnstake> {
  try {
    const {body} = JSON.parse(tx.unsignedPayload);
    const nodes: Record<string, NewUnstake> = body.messages.reduce((nodes: Record<string, NewUnstake>, message: UnstakeOperation) => {
      if (message.typeUrl === UNSTAKE_TYPE_URL) {
        const {operatorAddress, signer} = message.value;
        nodes[operatorAddress] = {
          operatorAddress,
          signer
        };
      }

      return nodes;
    }, {});

    return Object.values(nodes);
  } catch (err) {
    console.log("Something went wrong while parsing the transaction to extract the staked nodes information.");
    console.error(err);
    return [];
  }
}

export function extractTransactionSuppliers(tx: { unsignedPayload: string; type: string }): {
  kind: 'stake' | 'unstake' | 'other';
  ownerAddress: string | null;
  operatorAddresses: string[];
} {
  const unstake = extractTransactionUnstakingSuppliers(tx)
  if (unstake.length) return {
    kind: 'unstake' as const,
    ownerAddress: unstake[0]!.signer,
    operatorAddresses: unstake.map(u => u.operatorAddress),
  }
  const stake = extractTransactionStakingSuppliers(tx)
  if (stake.length) return {
    kind: 'stake' as const,
    ownerAddress: stake[0]!.ownerAddress,
    operatorAddresses: stake.map(s => s.address),
  }
  return { kind: 'other' as const, ownerAddress: null, operatorAddresses: [] as string[] }
}
