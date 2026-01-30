import { ActivityHeader } from '@igniter/ui/components/ActivityHeader';
import { useWalletConnection } from '@igniter/ui/context/WalletConnection/index'
import { useEffect, useState } from 'react'
import { getShortAddress } from '@igniter/ui/lib/utils'
import { Checkbox } from '@igniter/ui/components/checkbox'
import { Button } from '@igniter/ui/components/button'
import Amount from '@igniter/ui/components/Amount'
import AvatarByString from '@igniter/ui/components/AvatarByString'

interface OwnerAddressStepProps {
  onClose: () => void;
  selectedOwnerAddress?: string;
  onOwnerAddressSelected: (address: string) => void;
  preselectedForPersonalPlan?: string;
}

export default function OwnerAddressStep({onClose, onOwnerAddressSelected, selectedOwnerAddress: selectedOwnerAddressFromProps, preselectedForPersonalPlan}: OwnerAddressStepProps) {
  const {connectedIdentity, connectedIdentities, getBalance} = useWalletConnection();
  const [{data: balancesByAddress, error, loading}, setBalancesState] = useState<{
    data: Record<string, number> | null
    loading: boolean,
    error: boolean
  }>({
    data: null,
    loading: false,
    error: false
  })
  const [selectedOwnerAddress, setSelectedOwnerAddress] = useState(selectedOwnerAddressFromProps || '')

  const fetchBalances = async () => {
    setBalancesState(prevState => ({
      ...prevState,
      loading: true,
    }))

    Promise.all(
      connectedIdentities!.map((address) => {
        return getBalance(address).then((balance) => {
          return {address, balance}
        })
      })
    ).then((balances) => {
      setBalancesState({
        loading: false,
        error: false,
        data: balances.reduce((acc: Record<string, number>, {address, balance}) => {
          acc[address] = balance
          return acc
        }, {})
      })
    }).catch(() => {
      setBalancesState({
        loading: false,
        error: true,
        data: null
      })
    })
  }

  useEffect(() => {
    fetchBalances()
  }, [connectedIdentities])

  // Determine the highlighted account: preselected linked account if exists, otherwise signed-in account
  const highlightedAccount = preselectedForPersonalPlan
    ? connectedIdentities?.find(addr => addr.toLowerCase() === preselectedForPersonalPlan.toLowerCase()) || connectedIdentity!
    : connectedIdentity!;

  const isHighlightedPreselected = preselectedForPersonalPlan?.toLowerCase() === highlightedAccount.toLowerCase();

  // Other accounts are all connected accounts except the highlighted one
  const otherAccounts = connectedIdentities!.filter(
    a => a.toLowerCase() !== highlightedAccount.toLowerCase()
  );

  return (
    <div
      className="flex relative flex-col w-[580px] border-x border-b border-[--balck-deviders] bg-[--black-1] p-[33px] rounded-b-[12px] gap-8">
      <ActivityHeader
        title="Stake"
        subtitle="Select the owner address of your nodes."
        onClose={onClose}
      />

      <div className={'flex flex-col gap-4 h-full overflow-y-auto'}>
        {/* Highlighted account at top */}
        <div
          className={`w-full h-11 cursor-pointer select-none flex flex-row items-center gap-2 py-3 pl-3 pr-4 bg-(--input-bg) border rounded-lg ${
            isHighlightedPreselected ? 'border-purple-500/50' : 'border-amber-100'
          }`}
          onClick={() => setSelectedOwnerAddress(highlightedAccount)}
        >
          <AvatarByString string={highlightedAccount} />
          <div className="flex flex-col w-full gap-0">
            <p className="font-mono text-sm">
              {getShortAddress(highlightedAccount, 5)}
            </p>
          </div>
          {balancesByAddress && typeof balancesByAddress[highlightedAccount] === 'number' ? (
            <p className={'whitespace-nowrap !text-xs mr-2 mb-1'}>
              <Amount value={balancesByAddress[highlightedAccount] || 0} />
            </p>
          ) : loading ? (
            <p>
              Loading
            </p>
          ): (
            <p>
              Error
            </p>
          )}
          <Checkbox
            checked={selectedOwnerAddress === highlightedAccount}
          />
        </div>
        <p className={`!text-[10px] mb-2.5 mt-[-12px] ml-1 ${isHighlightedPreselected ? 'text-purple-300' : ''}`}>
          {isHighlightedPreselected
            ? 'Preselected because the plan you chose is linked to this wallet.'
            : "You're signed in with this account."}
        </p>

        <div className="absolute left-[24px] top-[246px] w-[432px] h-[1px] bg-[var(--slate-dividers)]"/>

        {/* Other accounts */}
        {otherAccounts.map((address) => {
          const isSignedInAccount = address.toLowerCase() === connectedIdentity?.toLowerCase();
          return (
            <div key={address} className="flex flex-col">
              <div
                className="w-full h-11 cursor-pointer select-none flex flex-row items-center gap-2 py-3 pl-3 pr-4 bg-(--input-bg) border rounded-lg"
                onClick={() => setSelectedOwnerAddress(address)}
              >
                <AvatarByString string={address} />
                <div className="flex flex-col w-full gap-0">
                  <p className="font-mono text-sm">
                    {getShortAddress(address, 5)}
                  </p>
                </div>
                {balancesByAddress && typeof balancesByAddress[address] === 'number' ? (
                  <p className={'whitespace-nowrap !text-xs mr-2 mb-1'}>
                    <Amount value={balancesByAddress[address]} />
                  </p>
                ) : loading ? (
                  <p>
                    Loading
                  </p>
                ): (
                  <p>
                    Error
                  </p>
                )}

                <Checkbox
                  checked={selectedOwnerAddress === address}
                />
              </div>
              {isSignedInAccount && isHighlightedPreselected && (
                <p className={'!text-[10px] mt-1 ml-1'}>
                  You're signed in with this account.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <Button
        disabled={!selectedOwnerAddress}
        className="w-full h-[40px]"
        onClick={() => onOwnerAddressSelected(selectedOwnerAddress)}
      >
        Continue
      </Button>
    </div>
  )
}
