'use client';
import { Button } from './button'
import CopyIcon from '../assets/icons/dark/copy.svg'
import CheckIcon from '../assets/icons/dark/check_success.svg'
import AvatarByString from './AvatarByString'
import React from 'react'
import { copyToClipboard, getShortAddress } from '../lib/utils'
import { clsx } from 'clsx'

interface AddressProps {
  address: string;
  onClick?: (address: string) => void;
  showAvatar?: boolean;
}

export default function Address({address, onClick, showAvatar}: AddressProps) {
  const [isCopied, setIsCopied] = React.useState(false);

  const handleCopy = () => {
    copyToClipboard(address).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1000);
    });
  };

  return (
    <div className={'flex items-center gap-3'}>
      {showAvatar && <AvatarByString string={address} size={18} />}
      <Button
        variant={'link'}
        className={
          clsx(
            '!p-0 text-accent border-none h-5 font-mono',
            !onClick && 'text-text-primary font-mono hover:no-underline !cursor-default'
          )
        }
        onClick={onClick ? () => onClick(address) : undefined}
      >
        {getShortAddress(address, 5)}
      </Button>
      <Button variant={'icon'} className={'h-5'} onClick={handleCopy}>
        {isCopied ? (
          <CheckIcon />
        ) : (
          <CopyIcon style={{marginTop: '4px'}} />
        )}
      </Button>
    </div>
  )
}
