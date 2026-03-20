'use client';

import { ActivityHeader } from "@igniter/ui/components/ActivityHeader";
import { Button } from "@igniter/ui/components/button";
import { Skeleton } from "@igniter/ui/components/skeleton";
import { QuickInfoPopOverIcon } from "@igniter/ui/components/QuickInfoPopOverIcon";
import { CaretSmallIcon } from "@igniter/ui/assets";
import { useQuery } from "@tanstack/react-query";
import { GetUnstakeDuration } from "@/actions/Unstake";
import { formatDuration } from "@/lib/utils/time";
import { useState } from "react";

export interface InformationStepProps {
  onNext: () => void;
  onClose: () => void;
}

export function InformationStep({ onNext, onClose }: Readonly<InformationStepProps>) {
  const [showCalculationDetails, setShowCalculationDetails] = useState(false);

  const {
    data: unstakeDurationData,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['unstake-duration'],
    queryFn: GetUnstakeDuration,
  });

  const formattedDuration = unstakeDurationData ? formatDuration(unstakeDurationData.durationSeconds) : null;

  return (
    <div className="flex flex-col w-[480px] border-x border-b border-border-primary bg-bg-root p-[33px] rounded-b-[12px] gap-8">
      <ActivityHeader
        onClose={onClose}
        title="Unstake Nodes"
        subtitle="Review the unstaking process and timeline."
      />

      <div className="flex flex-col bg-[var(--bg-surface)] p-[16px] rounded-[8px] gap-4">
        <span className="text-[14px] text-[var(--text-tertiary)]">
          During the next{' '}
          {isLoading && <Skeleton className="inline-block w-[60px] h-5 bg-bg-elevated" />}
          {isError && <span className="text-error">N/A</span>}
          {formattedDuration && <span className="font-mono text-[var(--text-primary)]">{formattedDuration}</span>}
          , your nodes will not generate rewards. After this period, staked tokens will return to the owner addresses' wallets.
        </span>

        {isError && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-error">Failed to calculate unstake duration</span>
            <Button onClick={() => refetch()} className="h-[30px]">
              Retry
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col p-0 rounded-[8px] border border-[var(--border-primary)]">
        <div
          className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] hover:cursor-pointer"
          onClick={() => setShowCalculationDetails(!showCalculationDetails)}
        >
          <span className="flex flex-row items-center gap-2">
            {showCalculationDetails ? (
              <CaretSmallIcon className="transform rotate-90" />
            ) : (
              <CaretSmallIcon />
            )}
            <span className="text-[14px] text-[var(--text-tertiary)]">Calculation Details</span>
            <QuickInfoPopOverIcon
              title="Unstake Duration Calculation"
              description="The unstaking period is calculated based on network parameters and average block time."
              url=""
            />
          </span>
        </div>

        {showCalculationDetails && (
          <div className="flex flex-col p-4 gap-4">
            <div className="text-[14px] text-[var(--text-tertiary)]">
              The unstake duration is calculated using the following formula:
            </div>

            <div className="bg-[var(--bg-root)] p-3 rounded-[6px]">
              <div className="font-mono text-[13px] text-[var(--text-secondary)] mb-3">
                Duration = num_blocks_per_session × supplier_unbonding_period_sessions × avg_block_time
              </div>

              {unstakeDurationData && (
                <>
                  <div className="border-t border-[var(--border-primary)] pt-3 mt-3">
                    <div className="text-[12px] text-[var(--text-tertiary)] mb-2">
                      Where:
                    </div>
                    <div className="flex flex-col gap-1.5 text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--text-tertiary)] min-w-[220px]">num_blocks_per_session</span>
                        <span className="text-[var(--text-tertiary)]">=</span>
                        <span className="font-mono text-[var(--text-primary)]">
                          {unstakeDurationData.numBlocksPerSession.toLocaleString()} blocks
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--text-tertiary)] min-w-[220px]">supplier_unbonding_period_sessions</span>
                        <span className="text-[var(--text-tertiary)]">=</span>
                        <span className="font-mono text-[var(--text-primary)]">
                          {unstakeDurationData.supplierUnbondingPeriodSessions.toLocaleString()} sessions
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--text-tertiary)] min-w-[220px]">avg_block_time</span>
                        <span className="text-[var(--text-tertiary)]">=</span>
                        <span className="font-mono text-[var(--text-primary)]">
                          {unstakeDurationData.avgBlockTimeSeconds.toFixed(3)} seconds
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-[var(--border-primary)] pt-3 mt-3">
                    <div className="text-[12px] text-[var(--text-tertiary)] mb-2">
                      Calculation:
                    </div>
                    <div className="font-mono text-[12px] text-[var(--text-secondary)] flex flex-col gap-1">
                      <div>
                        Duration = {unstakeDurationData.numBlocksPerSession.toLocaleString()} × {unstakeDurationData.supplierUnbondingPeriodSessions.toLocaleString()} × {unstakeDurationData.avgBlockTimeSeconds.toFixed(3)}
                      </div>
                      <div>
                        Duration = {(unstakeDurationData.numBlocksPerSession * unstakeDurationData.supplierUnbondingPeriodSessions).toLocaleString()} × {unstakeDurationData.avgBlockTimeSeconds.toFixed(3)}
                      </div>
                      <div className="text-[var(--text-primary)] mt-1">
                        Duration ≈ {unstakeDurationData.durationSeconds.toLocaleString(undefined, { maximumFractionDigits: 0 })} seconds
                      </div>
                      <div className="text-[var(--text-primary)]">
                        Duration ≈ {formattedDuration}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="text-[12px] text-[var(--text-tertiary)]">
              The average block time is calculated from the last 30 days of block data to provide an accurate estimate.
            </div>
          </div>
        )}
      </div>

      <Button
        onClick={onNext}
        disabled={isLoading || isError}
        className="w-full"
      >
        Continue
      </Button>
    </div>
  );
}
