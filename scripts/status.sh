#!/bin/bash
# Pulseboard - Status Check Script
# This script displays the status of Pulseboard services

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}   Pulseboard - System Status   ${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""

# Check if services are running
echo -e "${BLUE}📊 Container Status:${NC}"
docker-compose ps
echo ""

# Check backend health
echo -e "${BLUE}🔍 Backend Health Check:${NC}"
if curl -f -s http://localhost:8000/health > /dev/null 2>&1; then
    HEALTH=$(curl -s http://localhost:8000/health)
    echo -e "${GREEN}✅ Backend is healthy${NC}"
    echo -e "${BLUE}   Response:${NC} $HEALTH"
else
    echo -e "${RED}❌ Backend is not responding${NC}"
fi
echo ""

# Check frontend
echo -e "${BLUE}🔍 Frontend Health Check:${NC}"
if curl -f -s http://localhost/ > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Frontend is accessible${NC}"
else
    echo -e "${RED}❌ Frontend is not responding${NC}"
fi
echo ""

# Check resource usage
echo -e "${BLUE}💻 Resource Usage:${NC}"
docker stats --no-stream pulseboard-backend pulseboard-frontend 2>/dev/null || echo -e "${YELLOW}⚠️  Containers not running${NC}"
echo ""

# Show recent logs
echo -e "${BLUE}📝 Recent Backend Logs (last 10 lines):${NC}"
docker-compose logs --tail=10 backend 2>/dev/null || echo -e "${YELLOW}⚠️  No logs available${NC}"
echo ""

# Show disk usage
echo -e "${BLUE}💾 Docker Disk Usage:${NC}"
docker system df
echo ""

# Show network info
echo -e "${BLUE}🌐 Network Information:${NC}"
docker network inspect pulseboard-network -f '{{range .Containers}}{{.Name}}: {{.IPv4Address}}{{println}}{{end}}' 2>/dev/null || echo -e "${YELLOW}⚠️  Network not found${NC}"
echo ""

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${GREEN}   Status check complete   ${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
