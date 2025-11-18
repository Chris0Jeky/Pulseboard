#!/bin/bash
# Pulseboard - Backup Script
# This script backs up the Pulseboard database

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}   Pulseboard - Database Backup   ${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""

# Create backups directory if it doesn't exist
BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"

# Generate timestamp for backup filename
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/pulseboard_backup_$TIMESTAMP.db"

# Check if backend container is running
if ! docker ps | grep -q pulseboard-backend; then
    echo -e "${RED}❌ Backend container is not running${NC}"
    echo -e "${YELLOW}Please start Pulseboard first with: ./scripts/start.sh${NC}"
    exit 1
fi

# Perform backup
echo -e "${BLUE}📦 Creating backup...${NC}"
echo -e "${BLUE}   Source:${NC} Backend container:/app/data/pulseboard.db"
echo -e "${BLUE}   Destination:${NC} $BACKUP_FILE"
echo ""

if docker cp pulseboard-backend:/app/data/pulseboard.db "$BACKUP_FILE"; then
    echo -e "${GREEN}✅ Backup created successfully${NC}"
    echo ""

    # Show backup size
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${BLUE}📊 Backup Details:${NC}"
    echo -e "   File: $BACKUP_FILE"
    echo -e "   Size: $SIZE"
    echo -e "   Date: $(date)"
    echo ""

    # List all backups
    echo -e "${BLUE}📁 All Backups:${NC}"
    ls -lh "$BACKUP_DIR"
    echo ""

    # Cleanup old backups (keep last 10)
    echo -e "${BLUE}🧹 Cleaning up old backups (keeping last 10)...${NC}"
    ls -t "$BACKUP_DIR"/pulseboard_backup_*.db | tail -n +11 | xargs -r rm
    echo -e "${GREEN}✅ Cleanup complete${NC}"
    echo ""
else
    echo -e "${RED}❌ Backup failed${NC}"
    exit 1
fi

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${GREEN}   Backup complete   ${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}To restore:${NC} ./scripts/restore.sh $BACKUP_FILE"
