import { StageStatus } from "@/app/app/unstake/types";
import { UnstakingProcessStatus } from "@/app/app/unstake/components/ReviewStep/UnstakingProcess";

export function stageSucceeded(stage: StageStatus) {
  return stage === 'success';
}

export function stageFailed(stage: StageStatus) {
  return stage === 'error';
}

export function getFailedStage(statusRegistry: Record<keyof UnstakingProcessStatus, StageStatus>): keyof UnstakingProcessStatus | undefined {
  return Object.entries(statusRegistry).find(([, stage]) => stageFailed(stage))?.[0] as keyof UnstakingProcessStatus | undefined;
}

export function allStagesSucceeded(statusRegistry: UnstakingProcessStatus) {
  return Object.values(statusRegistry).every(stageSucceeded);
}
