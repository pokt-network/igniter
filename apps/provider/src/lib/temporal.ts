import fs from "node:fs";
import { Client, Connection } from "@temporalio/client";

const client: Client = makeClient();

function makeClient(): Client {
  const connection = Connection.lazy({
    address: process.env.TEMPORAL_URL || "localhost:7233",
    tls: getTLSConfig(),
    apiKey: getApiKey(),
  });

  const NAMESPACE = getTemporalConfig().namespace;

  return new Client({ connection, namespace: NAMESPACE });
}

/**
 * Same TLS env contract as @igniter/temporal (client.ts / worker.ts):
 * TEMPORAL_TLS_ENABLED=true + TEMPORAL_CLIENT_CERT_PATH / TEMPORAL_CLIENT_KEY_PATH
 * (+ optional TEMPORAL_SERVER_ROOT_CA_PATH, TEMPORAL_TLS_SERVER_NAME).
 * Undefined when TLS is not enabled (unchanged default).
 */
export function getTLSConfig() {
  if (process.env.TEMPORAL_TLS_ENABLED !== "true") return undefined;
  const crtPath = process.env.TEMPORAL_CLIENT_CERT_PATH;
  const keyPath = process.env.TEMPORAL_CLIENT_KEY_PATH;
  const caPath = process.env.TEMPORAL_SERVER_ROOT_CA_PATH;
  if (!crtPath || !keyPath) {
    throw new Error("TEMPORAL_CLIENT_CERT_PATH and TEMPORAL_CLIENT_KEY_PATH are required when TEMPORAL_TLS_ENABLED=true");
  }
  return {
    clientCertPair: { crt: fs.readFileSync(crtPath), key: fs.readFileSync(keyPath) },
    serverNameOverride: process.env.TEMPORAL_TLS_SERVER_NAME,
    serverRootCACertificate: caPath ? fs.readFileSync(caPath) : undefined,
  };
}

/** Optional TEMPORAL_API_KEY bearer token; undefined when unset or blank. */
export function getApiKey(): string | undefined {
  const key = process.env.TEMPORAL_API_KEY?.trim();
  return key ? key : undefined;
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
