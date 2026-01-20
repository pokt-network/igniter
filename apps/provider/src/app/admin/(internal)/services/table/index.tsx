'use client';

import {useState} from "react";
import type {Service} from "@igniter/db/provider/schema";
import {DeleteService, ListServices} from "@/actions/Services";
import {Button} from "@igniter/ui/components/button";
import { Trash2Icon, PencilIcon } from "lucide-react";
import DataTable from "@igniter/ui/components/DataTable/index";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import {columns} from "./columns";
import {AddOrUpdateServiceDialog} from "@/components/AddOrUpdateServiceDialog";
import { useQuery } from '@tanstack/react-query'

export default function ServicesTable() {
  const {data: services, refetch: refetchServices, isLoading: isLoadingServices, isError} = useQuery({
    queryKey: ['services'],
    queryFn: async () => {
      const result = await ListServices();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      return result.data;
    },
    refetchInterval: 60000,
    initialData: []
  });

  const [updateService, setUpdateService] = useState<Service | null>(null);
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);
  const [isDeletingService, setIsDeletingService] = useState(false);

  const isLoading = isLoadingServices || isDeletingService;

  const content = (
    <DataTable
      isError={isError}
      isLoading={isLoading}
      refetch={refetchServices}
      columns={[
        ...columns,
        {
          id: 'actions',
          header: '',
          cell: ({ row }) => (
              <div className="flex gap-3 justify-end">
                  <Button
                      disabled={isLoading}
                      variant="ghost"
                      size="icon"
                      onClick={() => setUpdateService(row.original)}
                      title="Edit Region"
                      className={'h-4 w-4'}
                  >
                      <PencilIcon className="h-4 w-4" />
                  </Button>
                  <Button
                      disabled={isLoading}
                      variant="ghost"
                      size="icon"
                      onClick={() => setServiceToDelete(row.original)}
                      title="Delete Region"
                      className={'h-4 w-4'}
                  >
                      <Trash2Icon className="h-4 w-4 text-red-500" />
                  </Button>
              </div>
          )
        }
      ]}
      data={services}
      filters={[]}
      sorts={[]}
    />
  );

  const confirmDeleteService = async () => {
    if (!serviceToDelete) return;

    try {
      setIsDeletingService(true);
      const result = await DeleteService(serviceToDelete.serviceId);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      await refetchServices();
    } catch (error) {
      console.error("Failed to delete service:", error);
    } finally {
      setIsDeletingService(false);
      setServiceToDelete(null);
    }
  };

  return (
    <div className='flex flex-col gap-4'>
      {updateService && (
        <AddOrUpdateServiceDialog
          onClose={(shouldRefreshServices) => {
            setUpdateService(null);

            if (shouldRefreshServices) {
              refetchServices();
            }
          }}
          service={updateService}
        />
      )}
      <div className="py-2 overflow-y-scroll scrollbar-hidden">
        {content}
      </div>
      {serviceToDelete && (
        <ConfirmationDialog
          title="Delete Service"
          open={!!serviceToDelete}
          onClose={() => setServiceToDelete(null)}
          footerActions={
            <>
              <Button
                variant="outline"
                onClick={() => setServiceToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => confirmDeleteService()}
                disabled={isLoading}
              >
                Delete
              </Button>
            </>
          }
        >
          <p>
            Are you sure you want to delete the service "{serviceToDelete.name}"?
            This action cannot be undone.
          </p>
          <p>
            This will also delete all relations with addresses groups.
          </p>
        </ConfirmationDialog>
      )}
    </div>
  );
}
