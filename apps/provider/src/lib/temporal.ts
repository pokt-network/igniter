import { Client, Connection } from "@temporalio/client";

const client: Client = makeClient();

function makeClient(): Client {
  const connection = Connection.lazy({
    address: process.env.TEMPORAL_URL || "localhost:7233",
    // In production, pass options to configure TLS and other settings.
  });

  const NAMESPACE = getTemporalConfig().namespace;

  return new Client({ connection, namespace: NAMESPACE });
}

export function getTemporalConfig() {
  return {
    namespace: process.env.TEMPORAL_NAMESPACE || "provider",
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || "provider-operations",
  };
}

export function getTemporalClient(): Client {
  return client;
}
