'use client';
import { Button } from './button'
import CopyIcon from '../assets/icons/dark/copy.svg'
import CheckIcon from '../assets/icons/dark/check_success.svg'
import React from 'react'
import { copyToClipboard } from '../lib/utils'
import { useExplorerTxUrl } from '../context/explorer'

interface TransactionHashProps {
  hash: string;
  onClick?: () => void;
}

export default function TransactionHash({hash, onClick}: TransactionHashProps) {
  const [isCopied, setIsCopied] = React.useState(false);
  const explorerUrl = useExplorerTxUrl(hash);
  const truncateHash = hash.slice(0, 7) + '...' + hash.slice(-7);
  const hashClassName = '!p-0 text-accent border-none h-5 font-mono';

  const handleCopy = () => {
    copyToClipboard(hash).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1000);
    });
  };

  return (
    <div className={'flex items-center gap-3'}>
      {/* An onClick (the in-app detail drawer) wins; otherwise the hash opens the explorer, or is
          plain text on a network with no explorer rather than a link that does nothing. */}
      {onClick ? (
        <Button variant={'link'} className={hashClassName} onClick={onClick}>
          {truncateHash}
        </Button>
      ) : explorerUrl ? (
        // `!` because the unlayered global `a { color: inherit; text-decoration: none }` beats utilities
        <Button variant={'link'} className={`${hashClassName} !text-accent hover:!underline`} asChild>
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer" title={hash}>
            {truncateHash}
          </a>
        </Button>
      ) : (
        <span className={'h-5 font-mono text-sm font-medium'} title={hash}>{truncateHash}</span>
      )}
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
