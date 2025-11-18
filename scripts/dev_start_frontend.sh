#!/bin/bash
# Development startup script for Pulseboard frontend

set -e

cd "$(dirname "$0")/../frontend/pulseboard-web"

echo "=== Pulseboard Frontend Development Startup ==="
echo

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

echo
echo "=== Starting Pulseboard Frontend ==="
echo "Frontend will be available at: http://localhost:5173"
echo "Make sure the backend is running at http://localhost:8000"
echo

npm run dev
