"use client";

import type { ProviderInfoWithConnection } from '../../context/WalletConnection'
import { SiwpMessage } from '@poktscan/vault-siwp'
import { CircleCheckBig, CircleX, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import {Button} from "@igniter/ui/components/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@igniter/ui/components/dialog";
import DialogContentSectionHeader from "@igniter/ui/components/DialogContentSectionHeader";
import WalletPickerItem, {WalletPickerItemProps} from "./components/WalletPickerItem";
import {DialogClose} from "../dialog";
import {useWalletConnection} from "@igniter/ui/context/WalletConnection/index";
import { getShortAddress } from "../../lib/utils";
import { Checkbox } from '../checkbox'
import { LoaderIcon } from '../../assets'
import AvatarByString from "../AvatarByString";

const latestSignedInIdentityKey = 'last-signed-in-identity'

export type SignInStatus = 'wallet' | 'account' | 'chain' | 'signing' | 'success'

interface SelectWalletStepProps {
    onSelectProvider: (provider: ProviderInfoWithConnection) => void;
}

function SelectWalletStep({
  onSelectProvider,
}: SelectWalletStepProps) {
    const [detectedProviders, setDetectedProviders] = useState<WalletPickerItemProps[]>([]);
    const [status, setStatus] = useState<'loading' | 'error' | 'loaded'>('loading')
    const {
        getAvailableProviders,
    } = useWalletConnection();

    const getProviders = () => {
        setStatus('loading')
        getAvailableProviders()
          .then(providers => {
              setDetectedProviders(providers);
              setStatus('loaded');
          })
          .catch(() => {
              setStatus('error')
              setDetectedProviders([]);
          })
    }

    useEffect(() => {
        getProviders();
    }, [getAvailableProviders]);

    let content: React.ReactNode

    switch (status) {
        case 'loading': {
            content = (
              <div className={'h-[100px] flex justify-center items-center'}>
                  <LoaderIcon className={'animate-spin '} />
              </div>
            )
            break
        }
        case 'error': {
            content = (
              <div className={'flex flex-col gap-2 h-[100px] justify-center items-center px-4'}>
                  <p>There was an error loading the available wallets.</p>
                  <Button
                    variant={'secondary'}
                    onClick={getProviders}
                    className={'w-[120px]'}
                  >
                      Try Again
                  </Button>
              </div>
            )
            break
        }
        case 'loaded': {
            content = (
              <div className="flex flex-col gap-2 px-4 pt-3">
                  <DialogContentSectionHeader text="detected" />
                  {detectedProviders.length > 0 && detectedProviders.map((providerProps, index) => (
                    <WalletPickerItem
                      key={index}
                      {...providerProps}
                      onSelect={onSelectProvider}
                    />
                  ))}
                  {detectedProviders.length <= 0 && (
                    <DialogDescription className="!text-[14px] font-[var(--font-sans)] text-[var(--color-white-3)]">
                        No wallets detected.
                    </DialogDescription>
                  )}
              </div>
            )
            break
        }
    }

    return (
      (
        <>
            <div className="px-2 flex flex-col gap-5">
                <DialogHeader>
                    <DialogTitle className="!text-[16px] font-[var(--font-sans)] text-[var(--color-white-1)]">
                        Connect Wallet
                    </DialogTitle>
                    <DialogDescription className="!text-[14px] font-[var(--font-sans)] text-[var(--color-white-3)]">
                        Login anonymously using your preferred wallet.
                    </DialogDescription>
                </DialogHeader>

            </div>
            {content}
            <div className="absolute bottom-[54px] w-[318px] h-[1px] bg-[var(--slate-dividers)]"></div>
            <DialogFooter className="mt-4">
                <DialogClose className="w-full" asChild>
                    <Button
                      variant={'secondaryStretch'}
                    >
                        Cancel
                    </Button>
                </DialogClose>
            </DialogFooter>
        </>
      )
    )
}

interface SelectAccountStepProps {
    onSelectAccount: (address: string) => void;
    onBack: () => void;
}

function SelectAccountStep({
  onBack,
  onSelectAccount,
}: SelectAccountStepProps) {
    const [selectedAccount, setSelectedAccount] = useState('')

    const {
        connectedIdentities,
    } = useWalletConnection();

    const lastSignedInIdentity = localStorage.getItem(latestSignedInIdentityKey)

    let addressLastSignedIn = ''

    if (lastSignedInIdentity) {
        addressLastSignedIn = connectedIdentities?.find(address => getShortAddress(address) === lastSignedInIdentity) || ''
    }

    const addresses = addressLastSignedIn ? connectedIdentities!.filter(address => address !== addressLastSignedIn) : connectedIdentities!

    return (
      <>
          <DialogHeader>
              <DialogTitle className="!text-[16px] font-[var(--font-sans)] text-[var(--color-white-1)]">
                  Select your Account
              </DialogTitle>
              <DialogDescription className="!text-[14px] font-[var(--font-sans)] text-[var(--color-white-3)]">
                  Select the account you want to use to sign in.
              </DialogDescription>
          </DialogHeader>
          <div className={'flex flex-col gap-2 h-full overflow-y-auto'}>
              {addressLastSignedIn && (
                <>
                    <div
                      className="border border-amber-100 w-full h-11 cursor-pointer select-none flex flex-row items-center gap-2 py-3 pl-3 pr-4 bg-(--input-bg) border rounded-lg"
                      onClick={() => setSelectedAccount(addressLastSignedIn)}
                    >
                        <AvatarByString string={addressLastSignedIn} />
                        <div className="flex flex-col w-full gap-0">
                            <p className="font-mono text-sm">
                                {getShortAddress(addressLastSignedIn, 5)}
                            </p>
                        </div>
                        <Checkbox
                          checked={selectedAccount === addressLastSignedIn}
                        />
                    </div>
                    <p className={'!text-[10px] mb-4'}>
                        It appears this was the last account you signed in with.
                    </p>
                    <div className="absolute top-[160px] left-0 w-[318px] h-[1px] bg-[var(--slate-dividers)]"></div>
                </>
              )}
              {addresses!.map((address) => (
                <div
                  key={address}
                  className="w-full h-11 cursor-pointer select-none flex flex-row items-center gap-2 py-3 pl-3 pr-4 bg-(--input-bg) border rounded-lg"
                  onClick={() => setSelectedAccount(address)}
                >
                    <AvatarByString string={address} />
                    <div className="flex flex-col w-full gap-0">
                        <p className="font-mono text-sm">
                            {getShortAddress(address, 5)}
                        </p>
                    </div>
                    <Checkbox
                      checked={selectedAccount === address}
                    />
                </div>
              ))}
          </div>
          <div className="absolute bottom-[54px] w-[338px] h-[1px] bg-[var(--slate-dividers)]"></div>
          <DialogFooter className="mt-2">
              <Button
                variant={'secondaryStretch'}
                onClick={onBack}
              >
                  Back
              </Button>
              <Button
                disabled={!connectedIdentities?.includes(selectedAccount) || false}
                variant={'secondaryStretch'}
                onClick={() => onSelectAccount(selectedAccount)}
              >
                  Next
              </Button>
          </DialogFooter>
      </>
    )
}

const labelByChainId: Record<string, string> = {
    'pocket': 'Pocket Network Mainnet',
    'pocket-beta': 'Pocket Network Testnet',
    'pocket-alpha': 'Pocket Network Alpha',
}

interface EnsureExpectedChainStepProps {
    onBack: () => void;
    onNext: () => void;
}

function EnsureExpectedChainStep({
  onBack,
  onNext,
}: EnsureExpectedChainStepProps) {
    const { expectedChainId, getChain, switchChain } = useWalletConnection();
    const [status, setStatus] = useState<
      'loading-current-chain' |
      'error-current-chain' |
      'waiting-switch-chain' |
      'loading-switch-chain' |
      'error-switch-chain' |
      'success-switch-chain'
    >(
      'loading-current-chain'
    )

    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const nextTimeoutRef = useRef<NodeJS.Timeout | null>(null)

    const loadWalletCurrentChain = () => {
        setStatus('loading-current-chain')
        const time = Date.now()
        getChain().then(chain => {
            const currentTime = Date.now()

            const missingMs = 1000 - (currentTime - time)

            timeoutRef.current = setTimeout(() => {
                if (chain === expectedChainId) {
                    setStatus('success-switch-chain')
                    nextTimeoutRef.current = setTimeout(onNext, 1500)
                } else {
                    setStatus('waiting-switch-chain')
                }
            }, missingMs > 0 ? missingMs : 0)
        }).catch(() => {
            setStatus('error-current-chain')
        })
    }


    useEffect(() => {
        loadWalletCurrentChain()

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current)
                timeoutRef.current = null
            }

            if (nextTimeoutRef.current) {
              clearTimeout(nextTimeoutRef.current)
              nextTimeoutRef.current = null
            }
        }
    }, [])

    const switchToCurrentChain = () => {
        setStatus('loading-switch-chain')
        switchChain(expectedChainId).then(() => {
            setStatus('success-switch-chain')
          nextTimeoutRef.current = setTimeout(onNext, 1500)
        }).catch(() => {
            setStatus('error-switch-chain')
        })
    }

    let content: React.ReactNode

    switch (status) {
        case 'loading-current-chain': {
            content = (
              <div className={'flex flex-col gap-2 justify-center items-center h-[100px] px-4'}>
                  <LoaderIcon className={'animate-spin '} />
                  <p>
                      Checking your wallet current chain...
                  </p>
              </div>
            )
            break
        }
        case 'error-current-chain': {
            content = (
              <div className={'flex flex-col gap-2 min-h-[100px] justify-center items-center px-4'}>
                  <p>There was an error retrieving your wallet current chain.</p>
                  <Button
                    variant={'secondary'}
                    onClick={loadWalletCurrentChain}
                    className={'w-[120px]'}
                  >
                      Try Again
                  </Button>
              </div>
            )
            break;
        }
        case 'waiting-switch-chain': {
            content = (
              <div className={'flex flex-col gap-2 min-h-[100px] justify-center items-center px-0.5'}>
                <p>Your wallet must be set to <b>{labelByChainId[expectedChainId] || expectedChainId}</b></p>
                  <Button
                    variant={'secondary'}
                    onClick={switchToCurrentChain}
                    className={'w-[140px]'}
                  >
                      Switch Chain
                  </Button>
              </div>
            )
            break;
        }
        case 'loading-switch-chain': {
            content = (
              <div className={'flex flex-col gap-2 justify-center items-center h-[100px] px-4'}>
                  <LoaderIcon className={'animate-spin '} />
                  <p>
                      Waiting for you to switch your wallet current chain...
                  </p>
              </div>
            )
            break
        }
        case 'error-switch-chain': {
            content = (
              <div className={'flex flex-col gap-2 min-h-[100px] justify-center items-center px-4'}>
                  <p>There was an error switching your wallet current chain.</p>
                  <Button
                    variant={'secondary'}
                    onClick={switchToCurrentChain}
                    className={'w-[120px]'}
                  >
                      Try Again
                  </Button>
              </div>
            )
            break;
        }
        case 'success-switch-chain': {
            content = (
              <div className={'flex flex-col gap-2 min-h-[100px] justify-center items-center px-1'}>
                <div className={'flex flex-row items-center gap-2'}>
                  <CircleCheckBig className={'text-[var(--color-green-1)]'} />
                  <p>Your wallet is set!</p>
                </div>
                <p className={'text-center my-2'}>You will be prompted to sign a message to complete your sign in!</p>
              </div>
            )
            break
        }
    }

    return (
      <>
          <DialogHeader>
              <DialogTitle className="!text-[16px] font-[var(--font-sans)] text-[var(--color-white-1)]">
                  Ensure Expected Chain
              </DialogTitle>
              <DialogDescription className="!text-[14px] font-[var(--font-sans)] text-[var(--color-white-3)]">
                  Your wallet must be connected to {labelByChainId[expectedChainId] || expectedChainId}.
              </DialogDescription>
          </DialogHeader>
          {content}
          <div className="absolute bottom-[54px] w-[338px] h-[1px] bg-[var(--slate-dividers)]"></div>
          <DialogFooter className="mt-2">
              <Button
                variant={'secondaryStretch'}
                onClick={onBack}
              >
                  Back
              </Button>
              <Button
                disabled={status !== 'success-switch-chain'}
                variant={'secondaryStretch'}
                onClick={onNext}
              >
                  Next
              </Button>
          </DialogFooter>
      </>
    )
}

interface SignInStepProps {
  getCsrfToken: () => Promise<string>;
  onSignIn: (
    message: SiwpMessage,
    signature: string,
    publicKey: string,
  ) => Promise<void>;
}

function SignInStep({
  onSignIn,
  getCsrfToken
}: SignInStepProps) {
    const [status, setStatus] = useState<'waiting' | 'signing-message' | 'error' | 'rejected' | 'successful' | 'auth-error'>('waiting')
    const [errorDetails, setErrorDetails] = useState<string | null>(null)
    const [errorExpanded, setErrorExpanded] = useState(false)
    const [copied, setCopied] = useState(false)
  const {
    expectedChainId,
    connectedIdentity,
    getPublicKey,
    signMessage,
  } = useWalletConnection();

    const copyErrorToClipboard = async () => {
      if (errorDetails) {
        await navigator.clipboard.writeText(errorDetails)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    }

    const signSignInMessage = async () => {
      try {
        if (!connectedIdentity) {
          return
        }

        setStatus('signing-message')
        setErrorDetails(null)
        setErrorExpanded(false)

        const message = new SiwpMessage({
          domain: window.location.host,
          address: connectedIdentity,
          statement: "Sign in to Igniter",
          uri: window.location.origin,
          version: "1",
          chainId: expectedChainId,
          nonce: await getCsrfToken(),
        });

        const signature = await signMessage(message.prepareMessage(), connectedIdentity);
        const publicKey = await getPublicKey(connectedIdentity);

        localStorage.setItem(latestSignedInIdentityKey, getShortAddress(connectedIdentity));

        setStatus('successful')

        // Wait before calling onSignIn, then handle auth errors
        await new Promise(resolve => setTimeout(resolve, 500))

        try {
          await onSignIn(message, signature, publicKey)
        } catch (authError) {
          const errorMessage = authError instanceof Error ? authError.message : String(authError)
          const errorStack = authError instanceof Error ? authError.stack : undefined
          setErrorDetails(JSON.stringify({
            message: errorMessage,
            stack: errorStack,
            timestamp: new Date().toISOString(),
            address: connectedIdentity,
            chainId: expectedChainId,
          }, null, 2))
          setStatus('auth-error')
        }
      } catch (e) {
        console.log(e)
        if (e instanceof Error) {
          setStatus(e.message.includes('rejected') ? 'rejected' : 'error')
        } else {
          setStatus('error')
        }
      }
    }

  useEffect(() => {
    signSignInMessage()
  }, [])

    let content: React.ReactNode

  switch (status) {
      case 'waiting': {
        content = (
          <div className={'flex flex-col gap-2 min-h-[100px] justify-center items-center px-4'}>
            <Button
              variant={'secondary'}
              onClick={signSignInMessage}
              className={'w-[140px]'}
            >
              Sign Message
            </Button>
          </div>
        )
        break;
      }
    case 'signing-message': {
      content = (
        <div className={'flex flex-col gap-2 justify-center items-center h-[100px] px-4'}>
          <LoaderIcon className={'animate-spin '} />
          <p>
            Waiting for you to sign the message...
          </p>
        </div>
      )
      break
    }
    case 'rejected':
    case 'error': {
      content = (
        <div className={'flex flex-col gap-2 min-h-[65px] mb-2.5 justify-center items-center px-4'}>
          <CircleX className={'text-[color:#fe7c7c]'} />
          <p>
            {status === 'rejected' ? 'You rejected signing the message.' : 'There was an error signing the message.'}
          </p>
        </div>
      )
      break;
    }
    case 'auth-error': {
      content = (
        <div className={'flex flex-col gap-2 min-h-[65px] mb-2.5 justify-center items-center px-4'}>
          <CircleX className={'text-[color:#fe7c7c]'} />
          <p className={'text-center'}>
            Authentication failed. Please try again.
          </p>
          {errorDetails && (
            <div className={'w-full mt-2 -ml-5'}>
              <button
                onClick={() => setErrorExpanded(!errorExpanded)}
                className={'flex items-center gap-1 text-xs text-[var(--color-white-3)] hover:text-[var(--color-white-1)] transition-colors'}
              >
                {errorExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {errorExpanded ? 'Hide error details' : 'Show error details'}
              </button>
              {errorExpanded && (
                <div className={'mt-2 p-2 bg-[var(--color-slate-1)] rounded text-left'}>
                  <pre className={'text-[10px] text-[var(--color-white-3)] overflow-x-auto max-h-[100px] overflow-y-auto whitespace-pre-wrap break-all'}>
                    {errorDetails}
                  </pre>
                  <div className={'flex items-center justify-between mt-2 pt-2 border-t border-[var(--slate-dividers)]'}>
                    <p className={'text-[10px] text-[var(--color-white-4)]'}>
                      If this persists, copy and share with the developers.
                    </p>
                    <button
                      onClick={copyErrorToClipboard}
                      className={'flex items-center gap-1 text-[10px] text-[var(--color-white-3)] hover:text-[var(--color-white-1)] transition-colors'}
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )
      break;
    }
    case 'successful': {
      content = (
        <div className={'flex flex-col gap-2 min-h-[100px] justify-center items-center px-4'}>
          <CircleCheckBig className={'text-[var(--color-green-1)]'} />
          <p className={'text-center'}>
            Your message was signed successfully! You’ll be signed in and redirected to your dashboard.
          </p>
        </div>
      )
      break
    }
  }

    return (
      <>
          <DialogHeader>
              <DialogTitle className="!text-[16px] font-[var(--font-sans)] text-[var(--color-white-1)]">
                  Finish Sign-In
              </DialogTitle>
              <DialogDescription className="!text-[14px] font-[var(--font-sans)] text-[var(--color-white-3)]">
                To complete your sign-in, please sign the message to verify your identity.
              </DialogDescription>
          </DialogHeader>
          {content}
          <div className="absolute bottom-[54px] w-[338px] h-[1px] bg-[var(--slate-dividers)]"></div>
          <DialogFooter className="mt-2">
            <DialogClose className="w-full" asChild>
              <Button
                disabled={status === 'signing-message' || status === 'successful'}
                variant={'secondaryStretch'}
              >
                  Cancel
              </Button>
            </DialogClose>
            {['error', 'rejected', 'auth-error'].includes(status) && (
              <Button
                variant={'secondaryStretch'}
                onClick={signSignInMessage}
              >
                Try Again
              </Button>
            )}
          </DialogFooter>
      </>
    )
}

export interface WalletPickerProps {
    onSignIn: (
      message: SiwpMessage,
      signature: string,
      publicKey: string,
    ) => Promise<void>;
    getCsrfToken: () => Promise<string>;
}

export function WalletPicker({ onSignIn, getCsrfToken }: Readonly<WalletPickerProps>) {
    const [open, setOpen] = useState(false);
    const {
        connectedIdentities,
        connectIdentity,
        connect,
    } = useWalletConnection();

    const [status, setStatus] = useState<SignInStatus>('wallet')

    useEffect(() => {
        setTimeout(() => {
            setStatus('wallet')
        }, 150)
    }, [open])

    const onSelectProvider = async (provider: ProviderInfoWithConnection) => {
        const connectedIdentities = await connect(provider);

        setStatus(connectedIdentities.length === 1 ? 'chain' : 'account');
    }

    const onSelectAccount = (address: string) => {
        if (address === '') return
        connectIdentity(address)

        setStatus('chain')
    }

    let content: React.ReactNode

    switch (status) {
        case 'wallet': {
            content = (
              <SelectWalletStep
                onSelectProvider={onSelectProvider}
              />
            )

            break;
        }
        case 'account': {
            content = (
              <SelectAccountStep
                onBack={() => setStatus('wallet')}
                onSelectAccount={onSelectAccount}
              />
            )
            break;
        }
        case 'chain': {
            content = (
              <EnsureExpectedChainStep
                onBack={() => setStatus((connectedIdentities?.length || 0) < 2 ? 'wallet' : 'account')}
                onNext={() => setStatus('signing')}
              />
            )
            break;
        }
        case 'signing': {
            content = (
              <SignInStep
                onSignIn={onSignIn}
                getCsrfToken={getCsrfToken}
              />
            )
            break;
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant={"secondary"}>Connect Wallet</Button>
            </DialogTrigger>
            <DialogContent className="w-[340px] pt-[20px] pb-[8px] px-[8px] rounded-lg shadow-[0_2px_12px_0_var(--shadow-1)] bg-[var(--color-slate-2)]" hideClose>
                {content}
            </DialogContent>
        </Dialog>
    );
}
