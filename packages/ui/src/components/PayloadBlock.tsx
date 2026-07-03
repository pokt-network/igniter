'use client';

import * as React from 'react';

import { cn } from '@igniter/ui/lib/utils';

export type PayloadBlockProps = {
  label: string;
  text: string;
  truncated?: boolean;
  decodeError?: string | null;
  variant?: 'default' | 'error';
  collapsedLines?: number;
  defaultExpanded?: boolean;
};

// Keep highlighting cheap: beyond this size render plain text.
const HIGHLIGHT_LIMIT = 50_000;

const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;

// Lightweight JSON syntax highlighting rendered as React nodes (no HTML injection).
function highlightJson(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  JSON_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JSON_TOKEN.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      nodes.push(
        <span key={key++} className="text-sky-300">
          {match[1]}
        </span>,
        match[2],
      );
    } else if (match[3] !== undefined) {
      nodes.push(
        <span key={key++} className="text-emerald-300">
          {match[3]}
        </span>,
      );
    } else if (match[4] !== undefined) {
      nodes.push(
        <span key={key++} className="text-purple-300">
          {match[4]}
        </span>,
      );
    } else if (match[5] !== undefined) {
      nodes.push(
        <span key={key++} className="text-amber-300">
          {match[5]}
        </span>,
      );
    }
    last = JSON_TOKEN.lastIndex;
  }
  nodes.push(text.slice(last));
  return nodes;
}

function looksLikeJson(text: string): boolean {
  const head = text.trimStart();
  return head.startsWith('{') || head.startsWith('[') || head.startsWith('"');
}

export function PayloadBlock({
  label,
  text,
  truncated = false,
  decodeError = null,
  variant = 'default',
  collapsedLines = 12,
  defaultExpanded = false,
}: PayloadBlockProps) {
  const [copied, setCopied] = React.useState(false);
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  const lines = React.useMemo(() => text.split('\n'), [text]);
  const collapsible = lines.length > collapsedLines;
  const visibleText =
    collapsible && !expanded ? lines.slice(0, collapsedLines).join('\n') : text;

  const rendered = React.useMemo(() => {
    const shouldHighlight =
      variant === 'default' &&
      !decodeError &&
      visibleText.length <= HIGHLIGHT_LIMIT &&
      looksLikeJson(visibleText);
    return shouldHighlight ? highlightJson(visibleText) : visibleText;
  }, [visibleText, variant, decodeError]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (non-secure context); ignore
    }
  };

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border',
        variant === 'error' ? 'border-red-500/40' : 'border-border-primary',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 border-b px-3 py-1.5',
          variant === 'error'
            ? 'border-red-500/40 bg-red-500/10'
            : 'border-border-primary bg-bg-elevated',
        )}
      >
        <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          {label}
        </span>
        {truncated && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
            truncated
          </span>
        )}
        {decodeError && (
          <span
            className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
            title={decodeError}
          >
            decode failed
          </span>
        )}
        <button
          type="button"
          onClick={onCopy}
          className="ml-auto text-xs text-text-secondary hover:text-text-primary"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        className={cn(
          'max-w-full overflow-x-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs leading-relaxed',
          variant === 'error' ? 'bg-red-500/5 text-red-300' : 'bg-(--input-bg) text-text-primary',
        )}
      >
        {rendered}
      </pre>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="block w-full border-t border-border-primary px-3 py-1 text-left text-xs text-text-secondary hover:text-text-primary"
        >
          {expanded ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}
