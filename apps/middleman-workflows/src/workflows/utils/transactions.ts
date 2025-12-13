import type {Transaction} from "@igniter/db/middleman/schema";
import { SEND_TYPE_URL, STAKE_TYPE_URL, UNSTAKE_TYPE_URL } from '@/lib/constants'

export interface NewStake {
  address: string;
  ownerAddress: string;
  stakeAmount: string;
  balance: number;
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

export function extractTransactionStakingSuppliers(tx: Transaction) {
  try {
    const {body} = JSON.parse(tx.unsignedPayload);
    const nodes: Record<string, NewStake> = body.messages.reduce((nodes: Record<string, NewStake>, message: StakeOperation) => {
      if (message.typeUrl === STAKE_TYPE_URL) {
        const {stake, operatorAddress, ownerAddress} = message.value;
        nodes[operatorAddress] = {
          address: operatorAddress,
          ownerAddress,
          stakeAmount: stake.amount.toString(),
          balance: nodes[operatorAddress]?.balance || 0,
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

export function extractTransactionUnstakingSuppliers(tx: Transaction): Array<NewUnstake> {
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
