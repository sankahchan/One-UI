#!/bin/bash

set -e

echo "🏗️  Building Frontend for Production..."

cd frontend

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build
echo "🔨 Building..."
npm run build

# Create deployment directory
sudo mkdir -p /var/www/xray-panel

# Copy build files
echo "📋 Copying build files..."
sudo cp -r dist/* /var/www/xray-panel/

# Set permissions
sudo chown -R www-data:www-data /var/www/xray-panel

echo "✅ Frontend build complete!"
echo "📍 Files deployed to: /var/www/xray-panel"
