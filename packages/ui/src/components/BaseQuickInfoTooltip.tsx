'use client';

import {Popover, PopoverContent, PopoverTrigger} from "./popover";
import {Button} from "./button";
import React from 'react'

export interface BaseQuickInfoTooltipProps {
  title: React.ReactNode;
  description: React.ReactNode;
  actionText?: string;
  url?: string;
  children: React.ReactNode;
}

export function BaseQuickInfoTooltip({title, description, actionText, children} : Readonly<BaseQuickInfoTooltipProps>) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent sideOffset={14} alignOffset={10} className="flex flex-col w-[260px] bg-bg-surface p-0">
        {typeof title === 'string' ? (
          <span className="text-[14px] text-text-primary p-[12px_16px]">
            {title}
          </span>
        ) : title}

        <hr className={'border-[color:var(--divider)]'} />

        {typeof description === 'string' ? (
          <span className="text-[14px] text-text-tertiary p-[12px_16px]">
            {description}
          </span>
        ) : description}

        {/*<hr className={'border-[color:var(--divider)]'} />*/}

        {/*<Button variant="secondaryBorder" className="m-2 w-[calc(100%-16px)] h-[30px]">*/}
        {/*  {actionText ?? 'Learn More'}*/}
        {/*</Button>*/}
      </PopoverContent>
    </Popover>
  );
}
