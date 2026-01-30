'use client'
import type {AddressGroupWithDetails} from '@igniter/db/provider/schema'
import {useRouter} from 'next/navigation'
import React, {useEffect, useState} from 'react'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@igniter/ui/components/select'
import OverrideSidebar from '@igniter/ui/components/OverrideSidebar'
import {ActivityHeader} from '@igniter/ui/components/ActivityHeader'
import {AbortConfirmationDialog} from '@igniter/ui/components/AbortConfirmationDialog'
import {Button} from '@igniter/ui/components/button'
import {LoaderIcon} from '@igniter/ui/assets'
import {toCurrencyFormat} from '@igniter/ui/lib/utils'
import {CountKeysByAddressGroupAndState, GetKeysByAddressGroupAndState} from '@/actions/Keys'
import {KeyStateLabels} from "@/app/admin/(internal)/keys/constants";
import type {KeyState} from "@igniter/db/provider/enums";

const exportToJson = (jsonData: object, name: string) => {
  const jsonString = JSON.stringify(jsonData, null, 2);

  const blob = new Blob([jsonString], {type: 'application/json'});

  const url = window.URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;

  link.download = name;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.URL.revokeObjectURL(url);
};


interface ExportFormProps {
  addressesGroup: AddressGroupWithDetails[]
}

export default function ExportForm({addressesGroup}: ExportFormProps) {
  const router = useRouter()
  const [isRedirecting, setIsRedirecting] = useState<boolean>(false);
  const [isAbortDialogOpen, setAbortDialogOpen] = useState(false)
  const [status, setStatus] = useState<'form' | 'success' | 'loading' | 'error'>('form')
  const [addressGroup, setAddressGroup] = useState<string>('')
  const [keyState, setKeyState] = useState<KeyState | undefined>()
  const [keysExported, setKeysExported] = useState(0)
  const [totalKeysCount, setTotalKeysCount] = useState<number | null>(null);
  const [isLoadingKeyCount, setIsLoadingKeyCount] = useState(false);

  const fetchTotalKeysCount = async (groupId: string, keyState?: KeyState) => {
    if (!groupId) return;

    setIsLoadingKeyCount(true);
    try {
      const result = await CountKeysByAddressGroupAndState(Number(groupId), keyState);

      if (!result || !result.success) {
        throw new Error('Failed to fetch keys count');
      }

      setTotalKeysCount(result.data);
    } catch (error) {
      console.error("Failed to fetch keys count:", error);
      setTotalKeysCount(null);
    } finally {
      setIsLoadingKeyCount(false);
    }
  };

  const exportKeys = async () => {
    if (!addressGroup || !keyState || status === 'loading') return;

    setStatus('loading')
    try {
      const result = await GetKeysByAddressGroupAndState(Number(addressGroup), keyState);

      if (!result || !result.success) {
        throw new Error('Failed to fetch keys');
      }

      const privateKeys = result.data;

      const filename = `${addressesGroup.find((a) => a.id === parseInt(addressGroup))?.name}-keys-at-${new Date().toISOString().replace(/[:.]/g, '_')}.json`;

      exportToJson(
        privateKeys.map(({privateKey}) => ({
          hex: privateKey
        })),
        filename,
      )
      setKeysExported(privateKeys.length)
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    if (addressGroup) {
      fetchTotalKeysCount(addressGroup, keyState);
    } else {
      setTotalKeysCount(null);
    }
  }, [addressGroup, keyState]);

  let content: React.ReactNode;

  if (status === 'form' || status === 'loading') {
    content = (
      <>
        <Select value={addressGroup} onValueChange={setAddressGroup}>
          <SelectTrigger className={'w-full'}>
            <SelectValue placeholder={'Select an address group'}/>
          </SelectTrigger>
          <SelectContent>
            {addressesGroup.map((addressGroup) => (
              <SelectItem value={addressGroup.id.toString()} key={addressGroup.id.toString()}>
                {addressGroup.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          disabled={!addressGroup}
          value={keyState}
          onValueChange={(value) => setKeyState(value as KeyState)}
        >
          <SelectTrigger className={'w-full'}>
            <SelectValue placeholder={'Select a key state'}/>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(KeyStateLabels).map(([value, label]) => (
              <SelectItem value={value} key={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {addressGroup && (
          <div className="p-4 rounded-md bg-[var(--color-slate-2)]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-[var(--color-white-3)]">Name</span>
                <span className="text-sm">
          {addressesGroup.find(group => group.id.toString() === addressGroup)?.name}
        </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium text-[var(--color-white-3)]">Visibility</span>
                <span className="text-sm">
          {addressesGroup.find(group => group.id.toString() === addressGroup)?.private ? 'Private' : 'Public'}
                </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--color-white-3)]">Keys to Export:</span>
                    <span className="text-sm">
              {isLoadingKeyCount ? (
                <div className="flex items-center justify-center px-4">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500"></div>
                </div>
              ) : totalKeysCount !== null ? (
                totalKeysCount
              ) : (
                "Failed to load"
              )}
            </span>
                  </div>

            </div>
          </div>
        )}

        <p>
          Example output:
          <br/>
          <div className="p-4 rounded-md bg-[var(--color-slate-2)] mt-2">
            <pre className="whitespace-pre-wrap">{JSON.stringify([{ hex: '<pk1>' },{ hex: '<pk2>' }], null, 2)}</pre>
          </div>
        </p>
        <Button
          className="w-full h-[40px]"
          onClick={exportKeys}
          disabled={status === 'loading' || !addressGroup || !totalKeysCount || totalKeysCount <= 0}
        >
          {status === 'loading' && (
            <LoaderIcon className="animate-spin"/>
          )}
          {status === 'form' && 'Export Keys'}
        </Button>
      </>
    )
  } else if (status === 'success') {
    content = (
      <>
        <div
          className={'relative flex h-[64px] mt-[-5px] gradient-border-green'}
        >
          <div
            className={`absolute inset-0 flex flex-row items-center bg-[var(--background)] rounded-[8px] p-[18px_25px] justify-between`}>
          <span className="text-[20px] text-[var(--color-white-3)]">
            Keys Exported
          </span>
            <div className="flex flex-row items-center gap-2">
              <p className="font-mono !text-[20px]">
                {toCurrencyFormat(keysExported, 0, 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col bg-[var(--color-slate-2)] p-0 rounded-[8px]">
          <span className="text-[14px] text-[var(--color-white-1)] p-[11px_16px]">
            You have successfully exported {keysExported} keys from the address group "{
            addressesGroup.find((a) => a.id === parseInt(addressGroup))?.name
          }".
          </span>
        </div>

        <Button
          className="w-full h-[40px]"
          onClick={() => {
            setIsRedirecting(true)
            router.push('/admin/keys')
          }}
        >
          {isRedirecting && (
            <LoaderIcon className="animate-spin"/>
          )}
          {!isRedirecting && 'Close'}
        </Button>
      </>
    )
  } else if (status === 'error') {
    content = (
      <>
        <div
          className={'relative flex h-[64px] mt-[-5px] gradient-border-red'}
        >
          <div
            className={`absolute inset-0 flex flex-row items-center bg-[var(--background)] rounded-[8px] p-[18px_25px] justify-between`}>
          <span className="text-[20px] text-[var(--color-white-3)]">
            Oops! Something went wrong.
          </span>
          </div>
        </div>

        <Button
          disabled={!totalKeysCount || totalKeysCount <= 0}
          className="w-full h-[40px]"
          onClick={exportKeys}
        >
          Try Again
        </Button>
      </>
    )
  }

  return (
    <>
      <OverrideSidebar>
        <div className="flex flex-row justify-center w-full">
          <div
            className="flex flex-col w-[480px] border-x border-b border-[--balck-deviders] bg-[--black-1] p-[33px] rounded-b-[12px] gap-8"
          >
            <ActivityHeader
              title="Export Addresses"
              subtitle={status === 'success' ? '' : 'Select the address group and export your keys json file.'}
              onClose={() => setAbortDialogOpen(true)}
              isDisabled={status === 'success'}
            />
            {content}
          </div>
        </div>
      </OverrideSidebar>
      <AbortConfirmationDialog
        type={'export'}
        isOpen={isAbortDialogOpen}
        onResponse={(abort) => {
          setAbortDialogOpen(false);
          if (abort) {
            setIsRedirecting(true)
            router.push('/admin/keys')
          }
        }}
      />
    </>
  )
}
