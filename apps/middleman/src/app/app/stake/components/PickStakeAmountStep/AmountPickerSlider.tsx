"use client";

import * as React from "react";

import SliderPrimitive from "@igniter/ui/components/slider";

export interface AmountPickerSliderProps {
    amount: number;
    balance: number;
    minimumStake: number;
    onValueChange: (value: number) => void;
}

function getSliderIntervals(balance: number, minimumStake: number, maxTicks = 16) {
    const totalSteps = Math.floor(balance / minimumStake);
    let intervals = [];

    if (totalSteps < maxTicks) {
        intervals = Array.from({ length: totalSteps + 1 }, (_, i) => i * minimumStake);
    } else {
        const tickSkipFactor = Math.ceil(totalSteps / (maxTicks - 1));
        for (let i = 0; i < maxTicks - 1; i++) {
            intervals.push(i * tickSkipFactor * minimumStake);
        }
        intervals.push(Math.floor(balance / minimumStake) * minimumStake);
    }

    return intervals;
}

export function AmountPickerSlider({amount, onValueChange, balance, minimumStake}: Readonly<AmountPickerSliderProps>) {
    const intervals = getSliderIntervals(balance, minimumStake);
    const maxAmount = Math.floor(balance / minimumStake) * minimumStake;

    return (
        <div className="relative w-full flex flex-col items-center">
            <SliderPrimitive.Root
                defaultValue={[amount]}
                value={[amount]}
                max={maxAmount}
                step={minimumStake}
                onValueChange={([value]) => onValueChange(value!)}
                className="relative flex w-full touch-none select-none items-center"
            >
                <SliderPrimitive.Track className="h-[10px] w-full rounded-[3px]  bg-bg-hover">
                    {intervals.map((interval) => (
                        <div
                            key={interval}
                            className="absolute w-[4px] h-[4px] rounded-[3px] bg-bg-root  top-1/2 transform -translate-y-1/2 hover:cursor-pointer"
                            style={{ left: `${(interval / balance) * 100}%` }}
                        />
                    ))}
                    <SliderPrimitive.Range className="absolute h-full rounded-[3px] bg-pnf-blue" />
                </SliderPrimitive.Track>
                <SliderPrimitive.Thumb className="h-6 w-6 flex items-center justify-center" asChild>
                    <span className="w-[12px] h-[26px] p-[8px_2px] rounded-[4px] bg-text-primary hover:cursor-pointer">
                        <svg width="8" height="10" viewBox="0 0 8 10" xmlns="http://www.w3.org/2000/svg">
                            <path d="m4.908 8.521 1.941-3.014a.928.928 0 0 0 0-1.014L4.908 1.479c-.301-.467-.951-.619-1.453-.338-.149.083-.273.2-.363.338L1.151 4.493a.928.928 0 0 0 0 1.014l1.941 3.014c.301.467.951.619 1.453.338.149-.083.273-.2.363-.338z" fill="#A3B0C0" fillRule="evenodd"/>
                        </svg>
                    </span>
                </SliderPrimitive.Thumb>
            </SliderPrimitive.Root>
        </div>
    );
}
