'use client';

import React, {useCallback, useMemo} from 'react';
import DataTable from "@igniter/ui/components/DataTable/index";
import { columns } from "./columns";
import { useQuery } from "@tanstack/react-query";
import {DeleteRegion, ListRegions} from "@/actions/Regions";
import {Button} from "@igniter/ui/components/button";
import { Trash2Icon, PencilIcon } from "lucide-react";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import type {Region} from "@igniter/db/provider/schema";
import {AddOrUpdateRegionDialog} from "@/components/AddOrUpdateRegionDialog";
import {useNotifications} from "@igniter/ui/context/Notifications/index";

export default function RegionsTable() {
    const { data: regions, isLoading: isLoadingRegions, refetch: refetchRegions, isError } = useQuery({
        queryKey: ['regions'],
        queryFn: async () => {
            const result = await ListRegions();
            if (!result.success) {
                throw new Error(result.error.message);
            }
            return result.data;
        },
        refetchInterval: 60000,
        initialData: []
    });
    const [updateRegion, setUpdateRegion] = React.useState<Region>();
    const [regionToDelete, setRegionToDelete] = React.useState<Region>();
    const [isDeletingRegion, setIsDeletingRegion] = React.useState(false);
    const { addNotification } = useNotifications();

    const isLoading = isLoadingRegions || isDeletingRegion

    const content = (
        <DataTable
          isLoading={isLoading}
          isError={isError}
          refetch={refetchRegions}
            columns={[
                ...columns,
                {
                    id: "actions",
                    cell: ({ row }) => {
                        const region = row.original;

                        return (
                            <div className="flex gap-2 justify-end">
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
                        );
                    },
                }
            ]}
            data={regions}
            filters={[]}
            sorts={[]}
        />
    );

    const confirmDeleteRegion = useCallback(async () => {
        if (!regionToDelete) return;

        setIsDeletingRegion(true);
        try {
            const result = await DeleteRegion(regionToDelete.id);
            if (!result.success) {
                throw new Error(result.error.message);
            }
            await refetchRegions();
        } catch (error) {
            console.error('Error deleting region:', error);
            addNotification({
                id: `delete-relay-miner-error`,
                type: 'error',
                showTypeIcon: true,
                content: error instanceof Error ? error.message : 'Unable to delete region. Please ensure it\'s not associated with any relay miner before trying again.',
            });
        } finally {
            setIsDeletingRegion(false);
            setRegionToDelete(undefined);
        }
    }, [regionToDelete]);

    return (
        <div className='flex flex-col gap-4'>
            {updateRegion && (
                <AddOrUpdateRegionDialog
                    onClose={(shouldRefreshRegions) => {
                        setUpdateRegion(undefined);

                        if (shouldRefreshRegions) {
                            refetchRegions();
                        }
                    }}
                    region={updateRegion}
                />
            )}
            <div className="py-2 max-h-[500px] min-h-[300px] overflow-y-scroll scrollbar-hidden">
                {content}
            </div>
            {regionToDelete && (
                <ConfirmationDialog
                    title="Delete Region"
                    open={!!regionToDelete}
                    onClose={() => setRegionToDelete(undefined)}
                    footerActions={
                        <>
                            <Button
                                variant="outline"
                                onClick={() => setRegionToDelete(undefined)}
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
                        Are you sure you want to delete the region "{regionToDelete.displayName}"?
                        This action cannot be undone.
                    </p>
                </ConfirmationDialog>
            )}
        </div>
    );
}
