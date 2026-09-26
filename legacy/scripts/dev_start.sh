#!/bin/bash
# Development startup script for Pulseboard backend

set -e

cd "$(dirname "$0")/.."

echo "=== Pulseboard Development Startup ==="
echo

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -q -r backend/requirements.txt

echo
echo "=== Starting Pulseboard Backend ==="
echo "API will be available at: http://localhost:8000"
echo "API docs at: http://localhost:8000/docs"
echo

cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
