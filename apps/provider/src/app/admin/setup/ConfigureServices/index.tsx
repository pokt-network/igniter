'use client';

import {useEffect, useState} from "react";
import type {Service} from "@igniter/db/provider/schema";
import {DeleteService, ListServices} from "@/actions/Services";
import {Button} from "@igniter/ui/components/button";
import {DataTable} from "@/components/DataTable";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import {columns} from "./Columns";
import {AddOrUpdateServiceDialog} from "@/components/AddOrUpdateServiceDialog";
import {LoaderIcon} from "@igniter/ui/assets";
import {PencilIcon, Trash2Icon} from "lucide-react";

export interface ConfigureServicesProp {
  goNext: () => void;
  goBack: () => void;
}

export default function ConfigureServices({ goNext, goBack }: Readonly<ConfigureServicesProp>) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingService, setIsAddingService] = useState(false);
  const [updateService, setUpdateService] = useState<Service | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);


  const content = services.length > 0
    ? (
        <DataTable
          columns={columns}
          data={services}
          searchableFields={["name", "serviceId"]}
          actions={
            <Button
              onClick={() => setIsAddingService(true) }
            >
              Add service
            </Button>
          }
          itemActions={(service) => (
              <div className="flex gap-2 justify-end pr-2">
                  <Button
                      disabled={isLoading}
                      variant="ghost"
                      size="icon"
                      onClick={() => setUpdateService(service)}
                      title="Edit Region"
                  >
                      <PencilIcon className="h-4 w-4" />
                  </Button>
                  <Button
                      disabled={isLoading}
                      variant="ghost"
                      size="icon"
                      onClick={() => setServiceToDelete(service)}
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
              onClick={() => setIsAddingService(true) }
            >
              Add your first service
            </Button>
          )}
          {isLoading && (
            <LoaderIcon className="animate-spin" />
          )}
        </div>
      );

  const fetchServices = async () => {
    try {
      setIsLoading(true);
      const result = await ListServices();
      if (!result.success) {
        throw new Error(result.error.message);
      }
      setServices(result.data);
    } catch (error) {
      console.error("Failed to fetch services:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDeleteService = async () => {
    if (!serviceToDelete) return;

    try {
      setIsLoading(true);
      const result = await DeleteService(serviceToDelete.serviceId);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      await fetchServices();
    } catch (error) {
      console.error("Failed to delete service:", error);
    } finally {
      setIsLoading(false);
      setServiceToDelete(null);
    }
  };

  useEffect(() => {
    fetchServices();
  }, []);

  return (
    <div className='flex flex-col gap-4'>
      {isAddingService && (
        <AddOrUpdateServiceDialog
          onClose={(shouldRefreshServices) => {
            setIsAddingService(false);

            if (shouldRefreshServices) {
              fetchServices();
            }
          }}
        />
      )}

      {updateService && (
        <AddOrUpdateServiceDialog
          onClose={(shouldRefreshServices) => {
            setUpdateService(null);

            if (shouldRefreshServices) {
              fetchServices();
            }
          }}
          service={updateService}
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
          disabled={isLoading || (services.length === 0)}
          onClick={goNext}
          >
          Next
        </Button>
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
        </ConfirmationDialog>
      )}
    </div>
  );
}
