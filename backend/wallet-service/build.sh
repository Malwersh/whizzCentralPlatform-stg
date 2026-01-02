#!/bin/bash

echo "📦 Building Wallet Service..."

# Clean dist
rm -rf dist
mkdir -p dist

# Compile TypeScript
npm run build

# Copy package.json and install production dependencies
cp package.json dist/
cd dist
npm install --production
cd ..

echo "✅ Build complete!"
