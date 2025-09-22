#!/bin/bash

# Al Ummah Now CMS - Production Deployment Script
# This script deploys the CMS to Cloudflare Workers with proper configuration

set -e

echo "🚀 Deploying Al Ummah Now CMS to Cloudflare Workers..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if wrangler is installed and user is logged in
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Wrangler CLI is not installed.${NC}"
    echo "Please install it with: npm install -g wrangler"
    exit 1
fi

if ! wrangler whoami &> /dev/null; then
    echo -e "${RED}❌ You are not logged in to Cloudflare.${NC}"
    echo "Please run: wrangler login"
    exit 1
fi

echo -e "${GREEN}✅ Wrangler CLI ready${NC}"

# Validate configuration
echo -e "${BLUE}🔍 Validating configuration...${NC}"

if [ ! -f "wrangler.json" ]; then
    echo -e "${RED}❌ wrangler.json not found${NC}"
    exit 1
fi

if [ ! -f "src/index.ts" ]; then
    echo -e "${RED}❌ src/index.ts not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Configuration files found${NC}"

# Check if D1 database exists
DB_NAME=$(grep -o '"database_name": "[^"]*"' wrangler.json | cut -d'"' -f4)
DB_ID=$(grep -o '"database_id": "[^"]*"' wrangler.json | cut -d'"' -f4)

echo -e "${BLUE}📊 Checking D1 database: ${DB_NAME}${NC}"

if wrangler d1 list | grep -q "$DB_ID"; then
    echo -e "${GREEN}✅ D1 database exists${NC}"
else
    echo -e "${RED}❌ D1 database not found${NC}"
    echo "Please run the setup script first: ./scripts/setup-cloudflare.sh"
    exit 1
fi

# Check if R2 bucket exists
R2_BUCKET=$(grep -o '"bucket_name": "[^"]*"' wrangler.json | cut -d'"' -f4)

echo -e "${BLUE}🪣 Checking R2 bucket: ${R2_BUCKET}${NC}"

if wrangler r2 bucket list | grep -q "$R2_BUCKET"; then
    echo -e "${GREEN}✅ R2 bucket exists${NC}"
else
    echo -e "${YELLOW}⚠️  R2 bucket not found. Creating it...${NC}"
    wrangler r2 bucket create "$R2_BUCKET"
    echo -e "${GREEN}✅ R2 bucket created${NC}"
fi

# Generate fresh TypeScript types
echo -e "${BLUE}📋 Generating TypeScript types...${NC}"
npm run typegen
echo -e "${GREEN}✅ TypeScript types updated${NC}"

# Build and validate TypeScript
echo -e "${BLUE}🔨 Validating TypeScript build...${NC}"
npx tsc --noEmit
echo -e "${GREEN}✅ TypeScript validation passed${NC}"

# Set production environment variables
echo -e "${BLUE}🔧 Setting production environment variables...${NC}"

# Check if production environment variables are set
REQUIRED_VARS=("AUTH_CLIENT_ID" "AUTH_CLIENT_SECRET")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if ! wrangler secret list | grep -q "$var"; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Some production environment variables are not set:${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "Would you like to set them now? (y/n)"
    read -r response
    
    if [[ "$response" =~ ^[Yy]$ ]]; then
        for var in "${MISSING_VARS[@]}"; do
            echo "Enter value for $var:"
            read -r -s value
            echo "$value" | wrangler secret put "$var"
            echo -e "${GREEN}✅ Set $var${NC}"
        done
    else
        echo -e "${YELLOW}⚠️  Skipping environment variable setup${NC}"
        echo "Note: Authentication may not work without proper credentials"
    fi
fi

# Deploy the Worker
echo ""
echo -e "${BLUE}🚀 Deploying to Cloudflare Workers...${NC}"
wrangler deploy

echo ""
echo -e "${GREEN}🎉 Deployment complete!${NC}"
echo ""

# Get the deployed URL
WORKER_URL=$(wrangler tail --format=pretty --once 2>&1 | grep -o 'https://[^/]*\.workers\.dev' | head -1 || echo "")

if [ -n "$WORKER_URL" ]; then
    echo -e "${BLUE}Your CMS is now live at:${NC}"
    echo "• Worker URL: ${YELLOW}${WORKER_URL}${NC}"
    echo "• Admin Panel: ${YELLOW}${WORKER_URL}/data${NC}"
    echo "• API Endpoint: ${YELLOW}${WORKER_URL}/api/articles${NC}"
else
    echo -e "${BLUE}Your CMS has been deployed successfully!${NC}"
    echo "Check the Cloudflare dashboard for your Worker URL."
fi

echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Visit your Worker URL to see the live CMS"
echo "2. Access the admin panel to manage content"
echo "3. Configure custom domain (www.alummahnow.net) in Cloudflare dashboard"
echo "4. Set up DNS records to point to your Worker"
echo ""
echo -e "${GREEN}Deployment successful! 🎊${NC}"