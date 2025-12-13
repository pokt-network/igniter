'use server'

import type { TransactionMessage } from '@igniter/ui/models'
import { Ripemd160, sha256 } from '@cosmjs/crypto'
import { toBech32, fromHex } from '@cosmjs/encoding'
import { EncodeObject, GeneratedType, makeAuthInfoBytes, Registry } from '@cosmjs/proto-signing'
import { PubKey } from '@igniter/pocket/proto/cosmos/crypto/secp256k1/keys';
import {MsgStakeSupplier, MsgUnstakeSupplier} from "@igniter/pocket/proto/pocket/supplier/tx";
import {MsgSend} from "@igniter/pocket/proto/cosmos/bank/v1beta1/tx";
import {Coin} from "@igniter/pocket/proto/cosmos/base/v1beta1/coin";
import { TxRaw } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'
import { getApplicationSettings } from '@/actions/ApplicationSettings'

function buildEncodeObjectFromMessage(message: TransactionMessage): EncodeObject {
  const { typeUrl, body } = message;
  switch (typeUrl) {
    case "/cosmos.bank.v1beta1.MsgSend":
      return {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: {
          ...MsgSend.fromJSON(body),
          amount: [
            Coin.fromJSON({
              amount: body.amount,
              denom: 'upokt',
            })
          ],
        }
      };
    case "/pocket.supplier.MsgStakeSupplier":
      return {
        typeUrl: "/pocket.supplier.MsgStakeSupplier",
        value: {
          ...MsgStakeSupplier.fromJSON(body),
          services: [],
          stake: Coin.fromJSON({
            denom: "upokt",
            amount: body.stakeAmount,
          }),
        }
      };
    case "/pocket.supplier.MsgUnstakeSupplier":
      return {
        typeUrl: "/pocket.supplier.MsgUnstakeSupplier",
        value: MsgUnstakeSupplier.fromJSON(body)
      };
    default:
      throw new Error(`Unsupported message type: ${typeUrl}`);
  }
}

export async function GetAccountSequence(address: string): Promise<{
  accountNumber: number,
  sequence: number,
}> {
  const applicationSettings = await getApplicationSettings();

  const apiUrl = applicationSettings.rpcUrl;

  console.log(applicationSettings)

  if (!apiUrl) {
    throw new Error('API URL not found');
  }

  const res = await fetch(`${apiUrl}/cosmos/auth/v1beta1/accounts/${address}`);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Fetch account sequence failed (${res.status}): ${text || 'no body'}`);
  }

  const data = await res.json();

  return {
    accountNumber: Number(data.account.account_number),
    sequence: Number(data.account.sequence)
  }
}

let registry: Registry | undefined = undefined

function getRegistry(): Registry {
  if (!registry) {
    registry = new Registry([
      ["/cosmos.bank.v1beta1.MsgSend", MsgSend as unknown as GeneratedType],
      ["/pocket.supplier.MsgStakeSupplier", MsgStakeSupplier as unknown as GeneratedType],
      ["/pocket.supplier.MsgUnstakeSupplier", MsgUnstakeSupplier as unknown as GeneratedType],
    ]);
  }

  return registry
}

function pubkeyToAddress(hexPubKey: string, prefix: string = "pokt"): string {
  // decode pubkey (base64 → raw bytes)
  const pubkeyBytes = fromHex(hexPubKey);

  // hash
  const sha256Hash = sha256(pubkeyBytes);
  const ripemdHash = new Ripemd160().update(sha256Hash).digest();

  // bech32 encode
  return toBech32(prefix, ripemdHash);
}

interface Tx {
  messages: Array<TransactionMessage>
  // hex pubkey
  signerPubKey: string
  memo?: string
}

const isBase64 = (str: string) => {
  try {
    return Buffer.from(str, 'base64').toString('base64') === str;
  } catch (err) {
    return false;
  }
}

export async function SimulateFee({
  messages,
  signerPubKey,
  memo,
}: Tx): Promise<{gas: number, fee: number}> {
  const pubKeyIsBase64 = isBase64(signerPubKey)

  const signer = pubKeyIsBase64 ? pubkeyToAddress(Buffer.from(signerPubKey, 'base64').toString('hex')) : pubkeyToAddress(signerPubKey)

  const msgs = messages.map(buildEncodeObjectFromMessage);
  const { sequence } = await GetAccountSequence(signer);

  const applicationSettings = await getApplicationSettings();

  const apiUrl = applicationSettings.rpcUrl;

  if (!apiUrl) {
    throw new Error('API URL not found');
  }

  const registry = getRegistry();
  const bodyBytes = registry.encodeTxBody({ messages: msgs, memo });

  const anyPubkey = {
    typeUrl: "/cosmos.crypto.secp256k1.PubKey",
    value: PubKey.encode({
      key: Buffer.from(signerPubKey,  pubKeyIsBase64 ? 'base64' : 'hex')
    }).finish()
  };

  const authInfoBytesForSim = makeAuthInfoBytes(
    [{ pubkey: anyPubkey, sequence }],
    [],
    0,
    undefined,
    signer,
  )

  const txRawForSim = TxRaw.fromPartial({
    bodyBytes,
    authInfoBytes: authInfoBytesForSim,
    signatures: [new Uint8Array()],
  });

  const txBytes = TxRaw.encode(txRawForSim).finish();
  const txBase64 = Buffer.from(txBytes).toString('base64');

  const res = await fetch(`${apiUrl}/cosmos/tx/v1beta1/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_bytes: txBase64 }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gas simulation failed (${res.status}): ${text || 'no body'}`);
  }

  const data: any = await res.json();
  const gasInfo = data?.gas_info;
  const gasUsedStr = gasInfo?.gas_used ?? gasInfo?.gas_wanted;

  const gasUsed = Number(gasUsedStr);
  if (!Number.isFinite(gasUsed) || gasUsed <= 0) {
    throw new Error(`Invalid simulation response: ${JSON.stringify(data)}`);
  }

  const gasAdjustment = 2;
  const gasPriceNum = 0.001;

  const gas = Math.ceil(gasUsed * gasAdjustment);
  const fee = Math.ceil(gas * gasPriceNum);

  return {
    gas,
    fee: fee / 1e6,
  };
}

export type SupplierParams = {
  params: {
    min_stake: {
      denom: string
      amount: string
    }
    staking_fee: {
      denom: string
      amount: string
    }
  }
}

export async function GetSupplierStakingFee() {
  const applicationSettings = await getApplicationSettings();

  const apiUrl = applicationSettings.rpcUrl;

  if (!apiUrl) {
    throw new Error('API URL not found');
  }

  const res = await fetch(`${apiUrl}/pokt-network/poktroll/supplier/params`);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Fetch supplier params failed (${res.status}): ${text || 'no body'}`);
  }

  const data: SupplierParams = await res.json();

  return Number(data.params.staking_fee.amount) / 1e6;
}
