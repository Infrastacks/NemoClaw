#!/bin/sh
set -e

echo "Starting NemoClaw runtime..."

# Start NemoClaw in background
cd /app
node agent/index.js &
AGENT_PID=$!

# Wait for agent process
wait $AGENT_PID
