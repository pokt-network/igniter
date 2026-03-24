#!/bin/bash

set -euo pipefail

APP=$1

if [[ -z "$APP" ]]; then
  echo "[ERROR] No app name provided. Please provide the app name as the first argument."
  exit 1
fi

# Function to handle cleanup
cleanup() {
  echo "[INFO] Performing cleanup..."
  rm -rf out
  echo "[INFO] Cleanup completed."
}

# Use trap to ensure cleanup is always performed
trap cleanup EXIT

echo "[INFO] Starting script..."

# Check if the app name is provided
if [[ -z "$APP" ]]; then
  echo "[ERROR] No app name provided. Please provide the app name as the first argument."
  exit 1
fi

echo "[INFO] App provided: $APP"

OUTPUT_FOLDER=./out/$APP

# Ensure no leftover files or directories exist
if [[ -d $OUTPUT_FOLDER ]]; then
  echo "[WARN] 'out' directory exists. Removing it..."
  rm -rf $OUTPUT_FOLDER
  echo "[INFO] 'out' directory removed."
fi

# Generate the necessary files with turbo prune
echo "[INFO] Running turbo prune for app: $APP"
pnpm exec turbo prune @igniter/$APP --out-dir $OUTPUT_FOLDER --docker
echo "[INFO] Turbo prune completed."

# Build the Docker image
DOCKER_TAG="${EXPECTED_REF:-igniter/$APP:dev}"
echo "[INFO] Starting Docker build for app: $APP tag: $DOCKER_TAG"
docker build . -f k8s/apps/$APP/Dockerfile -t "$DOCKER_TAG"
echo "[INFO] Docker build completed. Image tagged as: $DOCKER_TAG"

echo "[INFO] Script completed successfully. Exiting..."
