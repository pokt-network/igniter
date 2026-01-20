'use client';

import { useEffect, useState } from "react";
import type { Region } from "@igniter/db/provider/schema";
import { DeleteRegion, ListRegions } from "@/actions/Regions";
import { Button } from "@igniter/ui/components/button";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { DataTable } from "@/components/DataTable";
import { columns } from "./Columns";
import { AddOrUpdateRegionDialog } from "@/components/AddOrUpdateRegionDialog";
import { LoaderIcon } from "@igniter/ui/assets";
import {PencilIcon, Trash2Icon} from "lucide-react";

export interface ConfigureRegionsProps {
  goNext?: () => void;
  goBack?: () => void;
}

export default function ConfigureRegions({ goNext, goBack }: Readonly<ConfigureRegionsProps>) {
  const [isLoadingRegions, setIsLoadingRegions] = useState(false);
  const [isAddingRegion, setIsAddingRegion] = useState(false);
  const [isDeletingRegion, setIsDeletingRegion] = useState(false);
  const [updateRegion, setUpdateRegion] = useState<Region | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionToDelete, setRegionToDelete] = useState<Region | null>(null);

  const isLoading = isLoadingRegions || isDeletingRegion;

  const content = regions.length > 0
    ? (
        <DataTable
          columns={columns}
          data={regions}
          searchableFields={["displayName", "urlValue"]}
          actions={
            <Button
              onClick={() => setIsAddingRegion(true)}
            >
              Add Region
            </Button>
          }
          itemActions={(region) => (
              <div className="flex gap-2 justify-end pr-2">
                  <Button
                      disabled={isLoading}
                      variant="ghost"
                      size="icon"
                      onClick={() => setUpdateRegion(region)}
                      title="Edit Region"
                  >
                      <PencilIcon className="h-4 w-4" />
                  </Button>
                  <Button
                      disabled={isLoading}
                      variant="ghost"
                      size="icon"
                      onClick={() => setRegionToDelete(region)}
                      title="Delete Region"
                  >
                      <Trash2Icon className="h-4 w-4 text-red-500" />
                  </Button>
              </div>
          )}
        />
      )
    : (
        <div className="flex justify-center items-center w-full h-[300px]">
          {!isLoading && (
            <Button
              onClick={() => setIsAddingRegion(true)}
            >
              Add your first Region
            </Button>
          )}
          {isLoading && (
            <LoaderIcon className="animate-spin" />
          )}
        </div>
      );

  const fetchRegions = async () => {
    try {
      setIsLoadingRegions(true);
      const response = await ListRegions();
      if (response.success) {
        setRegions(response.data);
      } else {
        console.error("Failed to fetch regions:", response.error);
      }
    } catch (error) {
      console.error("Failed to fetch regions:", error);
    } finally {
      setIsLoadingRegions(false);
    }
  };

  const confirmDeleteRegion = async () => {
    if (!regionToDelete) return;

    try {
      setIsDeletingRegion(true);
      const result = await DeleteRegion(regionToDelete.id);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      await fetchRegions();
    } catch (error) {
      console.error("Failed to delete region:", error);
    } finally {
      setIsDeletingRegion(false);
      setRegionToDelete(null);
    }
  };

  useEffect(() => {
    fetchRegions();
  }, []);

  return (
    <div className='flex flex-col gap-4'>
      {isAddingRegion && (
        <AddOrUpdateRegionDialog
          onClose={(shouldRefreshRegions) => {
            setIsAddingRegion(false);

            if (shouldRefreshRegions) {
              fetchRegions();
            }
          }}
        />
      )}

      {updateRegion && (
        <AddOrUpdateRegionDialog
          onClose={(shouldRefreshRegions) => {
            setUpdateRegion(null);

            if (shouldRefreshRegions) {
              fetchRegions();
            }
          }}
          region={updateRegion}
        />
      )}
      <div className="py-2 max-h-[500px] min-h-[300px] overflow-y-scroll scrollbar-hidden">
        {content}
      </div>
      {goNext && goBack && (
        <div className="flex justify-end gap-4">
          <Button
            disabled={isLoading}
            onClick={goBack}>
            Back
          </Button>
          <Button
            disabled={isLoading || (regions.length === 0)}
            onClick={goNext}
            >
            Next
          </Button>
        </div>
      )}
      {regionToDelete && (
        <ConfirmationDialog
          title="Delete Region"
          open={!!regionToDelete}
          onClose={() => setRegionToDelete(null)}
          footerActions={
            <>
              <Button
                variant="outline"
                onClick={() => setRegionToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => confirmDeleteRegion()}
                disabled={isLoading}
              >
                Delete
              </Button>
            </>
          }
        >
          <p>
            Are you sure you want to delete the region &quot;{regionToDelete.displayName}&quot;?
            This action cannot be undone and may affect Relay Miners that use this region.
          </p>
        </ConfirmationDialog>
      )}
    </div>
  );
}
