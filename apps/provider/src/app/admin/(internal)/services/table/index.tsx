'use client';

import {useState} from "react";
import type {Service} from "@igniter/db/provider/schema";
import {DeleteService, ListServices} from "@/actions/Services";
import {Button} from "@igniter/ui/components/button";
import { Trash2Icon, PencilIcon } from "lucide-react";
import DataTable from "@igniter/ui/components/DataTable/index";
import { ConfirmationDialog } from "@igniter/ui/components/ConfirmationDialog";
import {columns} from "./columns";
import {AddOrUpdateServiceDialog} from "@/components/AddOrUpdateServiceDialog";
import { useQuery } from '@tanstack/react-query'
import { notify } from "@igniter/ui/lib/sessionMessages";
import { getLogger } from '@igniter/logger';

const log = getLogger(['provider', 'ui', 'table']);

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
              <div className="flex gap-2 justify-end">
                  <Button
                      disabled={isLoading}
                      variant="ghost"
                      size="icon"
                      onClick={() => setUpdateService(row.original)}
                      title="Edit Service"
                  >
                      <PencilIcon className="h-4 w-4" />
                  </Button>
                  <Button
                      disabled={isLoading}
                      variant="ghost"
                      size="icon"
                      onClick={() => setServiceToDelete(row.original)}
                      title="Delete Service"
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
      searchableColumns={['name', 'serviceId']}
      searchPlaceholder="Search by name or service ID..."
      countLabel="services"
    />
  );

  const confirmDeleteService = async () => {
    if (!serviceToDelete) return;

    try {
      setIsDeletingService(true);
      const result = await DeleteService(serviceToDelete.serviceId);
      if (!result.success) {
        // No CONSTRAINT_VIOLATION branch here on purpose: `dal/services.remove`
        // deletes the address_group_services rows itself before deleting the
        // service, so the only FK pointing at services never fires. A guard here
        // would advertise a protection that does not exist.
        throw new Error(result.error.message);
      }
      await refetchServices();
    } catch (error) {
      log.error("Failed to delete service", { error: error })
      notify.error('Unable to delete service.', {
        id: `delete-service-error`,
        description:
          error instanceof Error
            ? error.message
            : 'Please try again or contact support if the problem persists.',
      });
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
      <div className="py-2">
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
