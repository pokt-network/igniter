'use client';

import {useEffect, useMemo, useState} from "react";
import type {AddressGroup, AddressGroupWithDetails, Service} from "@igniter/db/provider/schema";
import {DeleteAddressGroup, ListAddressGroups} from "@/actions/AddressGroups";
import {Button} from "@igniter/ui/components/button";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import {DataTable} from "@/components/DataTable";
import {columns} from "./Columns";
import {AddOrUpdateAddressGroupDialog} from "@/components/AddOrUpdateAddressGroupDialog";
import {LoaderIcon} from "@igniter/ui/assets";
import {ListServices} from "@/actions/Services";
import {PencilIcon, Trash2Icon} from "lucide-react";

export interface ConfigureAddressGroupsProp {
  goNext: () => void;
  goBack: () => void;
}

export default function ConfigureAddressGroups({ goNext, goBack }: Readonly<ConfigureAddressGroupsProp>) {
  const [isLoadingAddressGroups, setIsLoadingAddressGroups] = useState(false);
  const [isLoadingServices, setIsLoadingServices] = useState(false);
  const [isAddingAddressGroup, setIsAddingAddressGroup] = useState(false);
  const [isDeletingAddressGroup, setIsDeletingAddressGroup] = useState(false);
  const [updateAddressGroup, setUpdateAddressGroup] = useState<AddressGroupWithDetails | null>(null);
  const [addressGroups, setAddressGroups] = useState<AddressGroupWithDetails[]>([]);
  const [addressGroupToDelete, setAddressGroupToDelete] = useState<AddressGroup | null>(null);
  const [services, setServices] = useState<Service[]>([]);

  const isLoading = useMemo(() => {
    return isLoadingAddressGroups ||
      isLoadingServices ||
      isDeletingAddressGroup;
    }, [isLoadingAddressGroups, isLoadingServices, isDeletingAddressGroup]);

  const content = addressGroups.length > 0
    ? (
        <DataTable
          columns={columns}
          data={addressGroups}
          searchableFields={["name", "region", "domain"]}
          actions={
            <Button
              onClick={() => setIsAddingAddressGroup(true) }
            >
              Add address Group
            </Button>
          }
          itemActions={(addressGroup) => (
              <div className="flex gap-2 justify-end pr-2">
                  <Button
                      disabled={isLoading}
                      variant="ghost"
                      size="icon"
                      onClick={() => setUpdateAddressGroup(addressGroup)}
                      title="Edit AddressGroup"
                  >
                      <PencilIcon className="h-4 w-4" />
                  </Button>
                  <Button
                      disabled={isLoading}
                      variant="ghost"
                      size="icon"
                      onClick={() => setAddressGroupToDelete(addressGroup)}
                      title="Delete AddressGroup"
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
              onClick={() => setIsAddingAddressGroup(true) }
            >
              Add your first Address Group
            </Button>
          )}
          {isLoading && (
            <LoaderIcon className="animate-spin" />
          )}
        </div>
      );

  const fetchAddressGroups = async () => {
    try {
      setIsLoadingAddressGroups(true);
      const result = await ListAddressGroups();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      setAddressGroups(result.data);
    } catch (error) {
      console.error("Failed to fetch addressGroups:", error);
    } finally {
      setIsLoadingAddressGroups(false);
    }
  };

  const confirmDeleteAddressGroup = async () => {
    if (!addressGroupToDelete) return;

    try {
      setIsDeletingAddressGroup(true);
      const result = await DeleteAddressGroup(addressGroupToDelete.id);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      await fetchAddressGroups();
    } catch (error) {
      console.error("Failed to delete addressGroup:", error);
    } finally {
      setIsDeletingAddressGroup(false);
      setAddressGroupToDelete(null);
    }
  };

  const fetchServices = async () => {
    try {
      setIsLoadingServices(true);
      const result = await ListServices();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      setServices(result.data);
    } catch (error) {
      console.error("Failed to fetch services:", error);
    } finally {
      setIsLoadingServices(false);
    }
  };

  useEffect(() => {
    fetchAddressGroups();
    fetchServices();
  }, []);

  return (
    <div className='flex flex-col gap-4'>
      {isAddingAddressGroup && (
        <AddOrUpdateAddressGroupDialog
          onClose={(shouldRefreshAddressGroups) => {
            setIsAddingAddressGroup(false);

            if (shouldRefreshAddressGroups) {
              fetchAddressGroups();
            }
          }}
        />
      )}

      {updateAddressGroup && (
        <AddOrUpdateAddressGroupDialog
          onClose={(shouldRefreshAddressGroups) => {
            setUpdateAddressGroup(null);

            if (shouldRefreshAddressGroups) {
              fetchAddressGroups();
            }
          }}
          addressGroup={updateAddressGroup}
        />
      )}
      <div className="py-2 max-h-[500px] min-h-[300px] overflow-y-scroll scrollbar-hidden">
        {content}
      </div>
      <div className="flex justify-end gap-4">
        <Button
          disabled={isLoading}
          onClick={goBack}>
          Back
        </Button>
        <Button
          disabled={isLoading || (addressGroups.length === 0)}
          onClick={goNext}
          >
          Next
        </Button>
      </div>
      {addressGroupToDelete && (
        <ConfirmationDialog
          title="Delete AddressGroup"
          open={!!addressGroupToDelete}
          onClose={() => setAddressGroupToDelete(null)}
          footerActions={
            <>
              <Button
                variant="outline"
                onClick={() => setAddressGroupToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => confirmDeleteAddressGroup()}
                disabled={isLoading}
              >
                Delete
              </Button>
            </>
          }
        >
          <p>
            Are you sure you want to delete the Address Group &quot;{addressGroupToDelete.name}&quot;?
            This action cannot be undone.
          </p>
        </ConfirmationDialog>
      )}
    </div>
  );
}
