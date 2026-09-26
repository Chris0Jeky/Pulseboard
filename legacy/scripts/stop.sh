#!/bin/bash
# Pulseboard - Stop Script
# This script stops Pulseboard Docker containers

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}   Pulseboard - Stopping Application   ${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""

# Parse command line arguments
REMOVE=false
VOLUMES=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --remove|-r)
            REMOVE=true
            shift
            ;;
        --volumes|-v)
            VOLUMES=true
            REMOVE=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: $0 [--remove] [--volumes]"
            echo "  --remove, -r  : Remove containers (keeps volumes)"
            echo "  --volumes, -v : Remove containers AND volumes (⚠️ deletes data)"
            exit 1
            ;;
    esac
done

# Stop services
if [ "$REMOVE" = true ]; then
    if [ "$VOLUMES" = true ]; then
        echo -e "${YELLOW}⚠️  WARNING: This will delete all data including the database!${NC}"
        read -p "Are you sure? (yes/no): " confirm
        if [ "$confirm" != "yes" ]; then
            echo -e "${BLUE}Cancelled${NC}"
            exit 0
        fi
        echo -e "${RED}🗑️  Removing containers and volumes...${NC}"
        docker-compose down -v
        echo -e "${GREEN}✅ Containers and volumes removed${NC}"
    else
        echo -e "${BLUE}🛑 Stopping and removing containers...${NC}"
        docker-compose down
        echo -e "${GREEN}✅ Containers removed (volumes preserved)${NC}"
    fi
else
    echo -e "${BLUE}🛑 Stopping containers...${NC}"
    docker-compose stop
    echo -e "${GREEN}✅ Containers stopped${NC}"
fi

echo ""
echo -e "${GREEN}Pulseboard stopped successfully${NC}"
echo ""
echo -e "${YELLOW}To start again:${NC} ./scripts/start.sh"
echo ""
