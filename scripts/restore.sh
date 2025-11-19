#!/bin/bash
# Pulseboard - Restore Script
# This script restores the Pulseboard database from a backup

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}   Pulseboard - Database Restore   ${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""

# Check for backup file argument
if [ $# -eq 0 ]; then
    echo -e "${RED}❌ No backup file specified${NC}"
    echo ""
    echo "Usage: $0 <backup_file>"
    echo ""
    echo "Available backups:"
    ls -lh ./backups/pulseboard_backup_*.db 2>/dev/null || echo "  No backups found"
    echo ""
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}❌ Backup file not found: $BACKUP_FILE${NC}"
    exit 1
fi

# Check if backend container is running
if ! docker ps | grep -q pulseboard-backend; then
    echo -e "${RED}❌ Backend container is not running${NC}"
    echo -e "${YELLOW}Please start Pulseboard first with: ./scripts/start.sh${NC}"
    exit 1
fi

# Warning about data loss
echo -e "${RED}⚠️  WARNING: This will replace the current database!${NC}"
echo -e "${YELLOW}All current data will be lost.${NC}"
echo ""
echo -e "${BLUE}Backup file:${NC} $BACKUP_FILE"
echo -e "${BLUE}Size:${NC} $(du -h "$BACKUP_FILE" | cut -f1)"
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo -e "${BLUE}Restore cancelled${NC}"
    exit 0
fi

# Stop backend to prevent database corruption
echo ""
echo -e "${BLUE}🛑 Stopping backend service...${NC}"
docker-compose stop backend

# Restore backup
echo -e "${BLUE}📦 Restoring backup...${NC}"
if docker cp "$BACKUP_FILE" pulseboard-backend:/app/data/pulseboard.db; then
    echo -e "${GREEN}✅ Backup restored successfully${NC}"
else
    echo -e "${RED}❌ Restore failed${NC}"
    echo -e "${YELLOW}Starting backend service...${NC}"
    docker-compose start backend
    exit 1
fi

# Restart backend
echo -e "${BLUE}🚀 Starting backend service...${NC}"
docker-compose start backend

# Wait for backend to be healthy
echo -e "${BLUE}⏳ Waiting for backend to be ready...${NC}"
sleep 5

# Check health
if curl -f -s http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is healthy${NC}"
else
    echo -e "${YELLOW}⚠️  Backend may still be starting...${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${GREEN}   Restore complete   ${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Note:${NC} You may need to refresh your browser to see the restored data"
