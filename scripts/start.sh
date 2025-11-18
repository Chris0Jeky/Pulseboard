#!/bin/bash
# Pulseboard - Start Script
# This script builds and starts Pulseboard using Docker Compose

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}   Pulseboard - Starting Application   ${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo "Please install Docker from https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed${NC}"
    echo "Please install Docker Compose from https://docs.docker.com/compose/install/"
    exit 1
fi

# Check if .env file exists, if not copy from example
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  No .env file found${NC}"
    if [ -f .env.example ]; then
        echo -e "${BLUE}📋 Copying .env.example to .env${NC}"
        cp .env.example .env
        echo -e "${GREEN}✅ Created .env file${NC}"
        echo -e "${YELLOW}⚠️  Please review and customize .env before production use${NC}"
    else
        echo -e "${RED}❌ .env.example not found${NC}"
        exit 1
    fi
fi

# Parse command line arguments
BUILD=false
DEV=false
DETACHED=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --build|-b)
            BUILD=true
            shift
            ;;
        --dev|-d)
            DEV=true
            shift
            ;;
        --detach|-D)
            DETACHED=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: $0 [--build] [--dev] [--detach]"
            echo "  --build, -b   : Force rebuild of images"
            echo "  --dev, -d     : Start in development mode"
            echo "  --detach, -D  : Run in background (detached mode)"
            exit 1
            ;;
    esac
done

# Determine which compose file to use
if [ "$DEV" = true ]; then
    COMPOSE_FILE="docker-compose.dev.yml"
    MODE="development"
else
    COMPOSE_FILE="docker-compose.yml"
    MODE="production"
fi

echo -e "${BLUE}📦 Mode: ${NC}${MODE}"
echo -e "${BLUE}📄 Compose file: ${NC}${COMPOSE_FILE}"
echo ""

# Build if requested
if [ "$BUILD" = true ]; then
    echo -e "${BLUE}🔨 Building Docker images...${NC}"
    docker-compose -f $COMPOSE_FILE build
    echo -e "${GREEN}✅ Build complete${NC}"
    echo ""
fi

# Start services
echo -e "${BLUE}🚀 Starting services...${NC}"
if [ "$DETACHED" = true ]; then
    docker-compose -f $COMPOSE_FILE up -d
    echo ""
    echo -e "${GREEN}✅ Services started in background${NC}"
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${GREEN}   Pulseboard is running!   ${NC}"
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo ""
    echo -e "🌐 Frontend:  ${GREEN}http://localhost${NC}"
    echo -e "🔌 Backend:   ${GREEN}http://localhost:8000${NC}"
    echo -e "📖 API Docs:  ${GREEN}http://localhost:8000/docs${NC}"
    echo ""
    echo -e "${YELLOW}View logs:${NC}    docker-compose -f $COMPOSE_FILE logs -f"
    echo -e "${YELLOW}Stop:${NC}         docker-compose -f $COMPOSE_FILE stop"
    echo -e "${YELLOW}Restart:${NC}      docker-compose -f $COMPOSE_FILE restart"
    echo ""
else
    docker-compose -f $COMPOSE_FILE up
fi
