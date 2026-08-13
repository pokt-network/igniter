
'use client';

import {useEffect, useMemo, useState} from "react";
import {Button} from "@igniter/ui/components/button";
import DataTable from '@igniter/ui/components/DataTable/index';
import {columns} from "./Columns";
import {LoaderIcon} from "@igniter/ui/assets";
import type {Delegator} from "@igniter/db/provider/schema";
import {
  DisableAllDelegators,
  EnableAllDelegators,
  ListDelegators,
  SyncDelegatorsFromGovernance,
} from "@/actions/Delegators";
import { SetupHelpBar } from "@/components/SetupHelpBar"
import { getLogger } from '@igniter/logger';

const log = getLogger(['provider', 'ui', 'ConfigureDelegators']);

export interface ConfigureDelegatorsProp {
  goNext: () => void;
  goBack: () => void;
}

export default function ConfigureDelegators({ goNext, goBack }: Readonly<ConfigureDelegatorsProp>) {
  const [isLoading, setIsLoading] = useState(false);
  const [delegators, setDelegators] = useState<Delegator[]>([]);
  const [isDisablingAllDelegators, setIsDisablingAllDelegators] = useState(false);
  const [isEnablingAllDelegators, setIsEnablingAllDelegators] = useState(false);

  const allowDisableAllDelegators = useMemo(() => {
    return delegators.length > 0 && delegators.some(d => d.enabled) && !isEnablingAllDelegators && !isDisablingAllDelegators;
  }, [JSON.stringify(delegators), isEnablingAllDelegators, isDisablingAllDelegators]);

  const allowEnableAllDelegators = useMemo(() => {
    return delegators.length > 0 && delegators.some(d => !d.enabled) && !isEnablingAllDelegators && !isDisablingAllDelegators;
  }, [JSON.stringify(delegators), isEnablingAllDelegators, isDisablingAllDelegators]);

  function disableAllDelegators() {
    (async function () {
      setIsDisablingAllDelegators(true);
      try {
        const result = await DisableAllDelegators();
        if (!result.success) {
          throw new Error(result.error.message);
        }
        await updateDelegatorsList();
      } catch (err) {
        log.error("Failed to disable all delegators", { error: err })
      } finally {
        setIsDisablingAllDelegators(false);
      }
    })();
  }

  function enableAllDelegators() {
    (async function () {
      setIsEnablingAllDelegators(true);
      try {
        const result = await EnableAllDelegators();
        if (!result.success) {
          throw new Error(result.error.message);
        }
        await updateDelegatorsList();
      } catch (err) {
        log.error("Failed to select all delegators", { error: err })
      } finally {
        setIsEnablingAllDelegators(false);
      }
    })();
  }

  const content = useMemo(() => {
    return !isLoading
      ? (
        <DataTable
          columns={columns}
          isDisabled={isDisablingAllDelegators || isEnablingAllDelegators}
          actions={
            <div className="flex gap-2">
              <Button
                disabled={!allowEnableAllDelegators}
                onClick={() => enableAllDelegators() }
              >
                Select All
              </Button>
              <Button
                disabled={!allowDisableAllDelegators}
                onClick={() => disableAllDelegators() }
              >
                Disable All
              </Button>
            </div>
          }
          data={delegators}
          searchableColumns={["name", "identity", "publicKey"]}
        />
      )
      : (
        <div className="flex justify-center items-center w-full h-[300px]">
          {isLoading && (
            <LoaderIcon className="animate-spin" />
          )}
        </div>
      );
  }, [JSON.stringify(delegators), isLoading, allowDisableAllDelegators, isDisablingAllDelegators])

  async function updateDelegatorsList() {
    try {
      setIsLoading(true);
      const result = await ListDelegators();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      setDelegators(result.data);
    } catch (error) {
      log.error("Failed to fetch delegators", { error: error })
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    setIsLoading(true);
    (async function () {
      try {
        const result = await SyncDelegatorsFromGovernance();
        if (!result.success) {
          throw new Error(result.error.message);
        }
      } catch (err) {
        log.error("Failed to update delegators from source", { error: err })
      }

      await updateDelegatorsList();
    })();
  }, []);

  return (
    <div className='flex flex-col gap-4'>
      <div className="py-2">
        {content}
      </div>
      <SetupHelpBar docAnchor="step-7--delegators" />
      <div className="flex justify-end gap-4">
        <Button
          variant="outline"
          disabled={isLoading}
          onClick={goBack}>
          Back
        </Button>
        <Button
          disabled={isLoading || (delegators.length === 0)}
          onClick={goNext}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
