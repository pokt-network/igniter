import { extractTransactionSuppliers, extractTransactionStakingSuppliers, STAKE_TYPE_URL, UNSTAKE_TYPE_URL, SEND_TYPE_URL } from './extractSuppliers'

const unstakeTx = {
  type: 'Unstake',
  unsignedPayload: JSON.stringify({ body: { messages: [
    { typeUrl: UNSTAKE_TYPE_URL, value: { signer: 'pokt1owner', operatorAddress: 'pokt1opA' } },
    { typeUrl: UNSTAKE_TYPE_URL, value: { signer: 'pokt1owner', operatorAddress: 'pokt1opB' } },
  ] } }),
}

test('extracts unstaking suppliers + owner', () => {
  const r = extractTransactionSuppliers(unstakeTx)
  expect(r.kind).toBe('unstake')
  expect(r.ownerAddress).toBe('pokt1owner')
  expect(r.operatorAddresses.sort()).toEqual(['pokt1opA', 'pokt1opB'])
})

test('malformed payload returns empty/other', () => {
  const r = extractTransactionSuppliers({ type: 'Unstake', unsignedPayload: 'not-json' })
  expect(r.operatorAddresses).toEqual([])
})

test('extracts staking suppliers + owner', () => {
  const stakeTx = {
    type: 'Stake',
    unsignedPayload: JSON.stringify({ body: { messages: [
      {
        typeUrl: STAKE_TYPE_URL,
        value: {
          signer: 'pokt1owner',
          ownerAddress: 'pokt1owner',
          operatorAddress: 'pokt1opC',
          stake: { denom: 'upokt', amount: 1000000 },
          services: [],
        },
      },
    ] } }),
  }
  const r = extractTransactionSuppliers(stakeTx)
  expect(r.kind).toBe('stake')
  expect(r.ownerAddress).toBe('pokt1owner')
  expect(r.operatorAddresses).toEqual(['pokt1opC'])
})

test('non-stake/unstake tx returns kind other', () => {
  const sendTx = {
    type: 'Send',
    unsignedPayload: JSON.stringify({ body: { messages: [
      { typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: { fromAddress: 'pokt1a', toAddress: 'pokt1b', amount: [] } },
    ] } }),
  }
  const r = extractTransactionSuppliers(sendTx)
  expect(r.kind).toBe('other')
  expect(r.ownerAddress).toBeNull()
  expect(r.operatorAddresses).toEqual([])
})

test('opFundsUpokt is populated when a MsgSend toAddress matches the operator', () => {
  const stakeTxWithSend = {
    type: 'Stake',
    unsignedPayload: JSON.stringify({ body: { messages: [
      {
        typeUrl: STAKE_TYPE_URL,
        value: {
          signer: 'pokt1owner',
          ownerAddress: 'pokt1owner',
          operatorAddress: 'pokt1opD',
          stake: { denom: 'upokt', amount: 2000000 },
          services: [],
        },
      },
      {
        typeUrl: SEND_TYPE_URL,
        value: {
          fromAddress: 'pokt1owner',
          toAddress: 'pokt1opD',
          amount: [{ denom: 'upokt', amount: 500000 }],
        },
      },
    ] } }),
  }
  const results = extractTransactionStakingSuppliers(stakeTxWithSend)
  expect(results).toHaveLength(1)
  expect(results[0]!.opFundsUpokt).toBe('500000')
})

test('opFundsUpokt is null when no MsgSend targets the operator', () => {
  const stakeTxNoSend = {
    type: 'Stake',
    unsignedPayload: JSON.stringify({ body: { messages: [
      {
        typeUrl: STAKE_TYPE_URL,
        value: {
          signer: 'pokt1owner',
          ownerAddress: 'pokt1owner',
          operatorAddress: 'pokt1opE',
          stake: { denom: 'upokt', amount: 3000000 },
          services: [],
        },
      },
    ] } }),
  }
  const results = extractTransactionStakingSuppliers(stakeTxNoSend)
  expect(results).toHaveLength(1)
  expect(results[0]!.opFundsUpokt).toBeNull()
})

test('opFundsUpokt is null when MsgSend toAddress does not match the operator', () => {
  const stakeTxWrongSend = {
    type: 'Stake',
    unsignedPayload: JSON.stringify({ body: { messages: [
      {
        typeUrl: STAKE_TYPE_URL,
        value: {
          signer: 'pokt1owner',
          ownerAddress: 'pokt1owner',
          operatorAddress: 'pokt1opF',
          stake: { denom: 'upokt', amount: 4000000 },
          services: [],
        },
      },
      {
        typeUrl: SEND_TYPE_URL,
        value: {
          fromAddress: 'pokt1owner',
          toAddress: 'pokt1someOtherAddress',
          amount: [{ denom: 'upokt', amount: 100000 }],
        },
      },
    ] } }),
  }
  const results = extractTransactionStakingSuppliers(stakeTxWrongSend)
  expect(results).toHaveLength(1)
  expect(results[0]!.opFundsUpokt).toBeNull()
})
