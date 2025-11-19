# Docker Deployment Guide

This guide explains how to run Pulseboard using Docker and Docker Compose.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Production Deployment](#production-deployment)
- [Development Setup](#development-setup)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Advanced Topics](#advanced-topics)

## Prerequisites

- **Docker**: Version 20.10 or later ([Install Docker](https://docs.docker.com/get-docker/))
- **Docker Compose**: Version 2.0 or later (included with Docker Desktop)
- **System Requirements**:
  - CPU: 2 cores minimum
  - RAM: 2GB minimum (4GB recommended)
  - Disk: 1GB free space

Verify installation:
```bash
docker --version
docker-compose --version
```

## Quick Start

### 1. Clone and Navigate

```bash
git clone https://github.com/yourusername/Pulseboard.git
cd Pulseboard
```

### 2. Start Services

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Check status
docker-compose ps
```

### 3. Access Application

- **Frontend**: http://localhost
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health

### 4. Stop Services

```bash
# Stop services (keeps data)
docker-compose stop

# Stop and remove containers (keeps volumes)
docker-compose down

# Remove everything including volumes (⚠️ deletes data)
docker-compose down -v
```

## Configuration

### Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` to customize your deployment:

```bash
# Application Environment
APP_ENV=production

# Ports
BACKEND_PORT=8000
FRONTEND_PORT=80

# CORS (important for security)
CORS_ORIGINS=["http://localhost", "http://yourdomain.com"]

# Logging
LOG_LEVEL=INFO
```

### Port Configuration

To change default ports, edit `docker-compose.yml`:

```yaml
services:
  backend:
    ports:
      - "8080:8000"  # Change 8080 to your desired port

  frontend:
    ports:
      - "3000:80"    # Change 3000 to your desired port
```

## Production Deployment

### Using docker-compose.yml (Production)

```bash
# Build images
docker-compose build

# Start in detached mode
docker-compose up -d

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Monitor resource usage
docker stats
```

### Behind a Reverse Proxy (Recommended)

For production, use a reverse proxy like Nginx or Traefik:

**Example nginx configuration:**

```nginx
# /etc/nginx/sites-available/pulseboard
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend
    location / {
        proxy_pass http://localhost;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### SSL/TLS Configuration

For HTTPS support, add SSL certificates:

```bash
# Using Let's Encrypt with Certbot
sudo certbot --nginx -d yourdomain.com

# Or manually configure SSL in nginx
```

## Development Setup

For local development with hot-reload:

```bash
# Use development compose file
docker-compose -f docker-compose.dev.yml up

# Or start specific services
docker-compose -f docker-compose.dev.yml up backend
docker-compose -f docker-compose.dev.yml up frontend
```

**Development features:**
- ✅ Live code reload (backend and frontend)
- ✅ Source code mounted as volumes
- ✅ Debug logging enabled
- ✅ No build optimization (faster startup)

## Architecture

### Services

**Backend (FastAPI + Python)**
- Port: 8000
- Image: Custom (multi-stage Python 3.11)
- Health check: `GET /health`
- Data volume: `pulseboard-backend-data`

**Frontend (Vue 3 + Nginx)**
- Port: 80
- Image: Custom (Node build + Nginx Alpine)
- Health check: `GET /`
- Static files served by Nginx

### Networking

Services communicate via a Docker bridge network:
- `pulseboard-network` (production)
- `pulseboard-network-dev` (development)

### Data Persistence

**Volumes:**
- `pulseboard-backend-data`: SQLite database
- `pulseboard-backend-logs`: Application logs

**Backup:**
```bash
# Backup database
docker cp pulseboard-backend:/app/data/pulseboard.db ./backup.db

# Restore database
docker cp ./backup.db pulseboard-backend:/app/data/pulseboard.db
docker-compose restart backend
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose logs backend
docker-compose logs frontend

# Inspect container
docker inspect pulseboard-backend

# Check health status
docker ps
```

### Connection Refused Errors

1. **Check services are running:**
   ```bash
   docker-compose ps
   ```

2. **Verify health checks:**
   ```bash
   docker inspect pulseboard-backend | grep Health
   ```

3. **Check CORS configuration:**
   - Ensure `CORS_ORIGINS` includes your frontend URL

### Database Issues

```bash
# Reset database (⚠️ deletes all data)
docker-compose down -v
docker-compose up -d

# Or manually delete volume
docker volume rm pulseboard-backend-data
```

### Build Failures

```bash
# Clear Docker cache
docker-compose build --no-cache

# Remove old images
docker image prune -a

# Check disk space
docker system df
```

### Port Conflicts

If ports are already in use:

```bash
# Find process using port 8000
lsof -i :8000  # macOS/Linux
netstat -ano | findstr :8000  # Windows

# Change ports in docker-compose.yml
ports:
  - "8080:8000"  # Use 8080 instead of 8000
```

## Advanced Topics

### Resource Limits

Adjust resource limits in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'
      memory: 1G
    reservations:
      cpus: '1.0'
      memory: 512M
```

### Multi-Stage Builds

Both Dockerfiles use multi-stage builds for optimization:

- **Backend**: Builder stage installs dependencies, runtime stage copies only what's needed
- **Frontend**: Node stage builds app, Nginx stage serves static files

### Health Checks

Health checks ensure services are ready:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

### Scaling

To run multiple backend instances:

```bash
docker-compose up --scale backend=3
```

**Note:** Requires load balancer configuration.

### Custom Builds

Build specific services:

```bash
# Build backend only
docker-compose build backend

# Build with different tag
docker build -t pulseboard-backend:v2 ./backend

# Push to registry
docker tag pulseboard-backend:v2 your-registry/pulseboard-backend:v2
docker push your-registry/pulseboard-backend:v2
```

### Monitoring

**View resource usage:**
```bash
docker stats
```

**Export logs:**
```bash
docker-compose logs > pulseboard.log
```

**Monitor in real-time:**
```bash
docker-compose logs -f --tail=100
```

## Security Best Practices

1. **Run as non-root user** ✅ (already configured)
2. **Use secrets for sensitive data**
3. **Keep images updated**
   ```bash
   docker-compose pull
   docker-compose up -d
   ```
4. **Scan for vulnerabilities**
   ```bash
   docker scan pulseboard-backend
   ```
5. **Limit network exposure**
6. **Enable firewall rules**

## Updating Pulseboard

```bash
# Pull latest changes
git pull origin main

# Rebuild images
docker-compose build

# Restart with new images
docker-compose up -d

# Check status
docker-compose ps
```

## Uninstalling

```bash
# Stop and remove everything
docker-compose down -v

# Remove images
docker rmi pulseboard-backend pulseboard-frontend

# Clean up Docker system
docker system prune -a --volumes
```

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/Pulseboard/issues)
- **Documentation**: [Main README](./README.md)
- **Logs**: Use `docker-compose logs` for debugging

---

**Need help?** Check logs first, then open an issue with:
- Docker version
- Docker Compose version
- Error messages from logs
- Steps to reproduce
