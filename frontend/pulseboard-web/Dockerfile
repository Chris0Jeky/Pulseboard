# ===================================
# Stage 1: Build
# ===================================
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /build

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production=false

# Copy source code
COPY . .

# Build the application
RUN npm run build

# ===================================
# Stage 2: Production
# ===================================
FROM nginx:1.25-alpine

# Set labels
LABEL maintainer="Pulseboard Contributors"
LABEL description="Pulseboard Frontend - Real-time data dashboard UI"
LABEL version="0.1.0"

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built application from builder
COPY --from=builder /build/dist /usr/share/nginx/html

# Create nginx user (already exists in nginx image)
# Remove default nginx config
RUN rm -f /etc/nginx/conf.d/default.conf.dpkg-dist

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# Run nginx
CMD ["nginx", "-g", "daemon off;"]
