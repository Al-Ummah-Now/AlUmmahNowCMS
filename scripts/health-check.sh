#!/bin/bash

# Al Ummah Now CMS - Health Check and Validation Script
# This script validates the Cloudflare Workers configuration and setup

set -e

echo "🩺 Al Ummah Now CMS Health Check..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check Node.js version
echo -e "${BLUE}🔍 Checking Node.js version...${NC}"
NODE_VERSION=$(node --version 2>/dev/null || echo "not installed")
if [[ "$NODE_VERSION" =~ ^v([0-9]+) ]] && [ "${BASH_REMATCH[1]}" -ge 18 ]; then
    echo -e "${GREEN}✅ Node.js $NODE_VERSION${NC}"
else
    echo -e "${RED}❌ Node.js 18+ required, found: $NODE_VERSION${NC}"
    exit 1
fi

# Check if dependencies are installed
echo -e "${BLUE}📦 Checking dependencies...${NC}"
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
    echo -e "${YELLOW}⚠️  Dependencies not installed. Installing...${NC}"
    npm install
fi
echo -e "${GREEN}✅ Dependencies installed${NC}"

# Check Wrangler CLI
echo -e "${BLUE}🔧 Checking Wrangler CLI...${NC}"
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Wrangler CLI not found${NC}"
    echo "Please install with: npm install -g wrangler"
    exit 1
fi
echo -e "${GREEN}✅ Wrangler CLI found${NC}"

# Check Cloudflare login
echo -e "${BLUE}🔐 Checking Cloudflare authentication...${NC}"
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}⚠️  Not logged in to Cloudflare${NC}"
    echo "Please run: npm run cf:login"
else
    echo -e "${GREEN}✅ Logged in to Cloudflare${NC}"
fi

# Check configuration files
echo -e "${BLUE}📄 Checking configuration files...${NC}"

if [ ! -f "wrangler.json" ]; then
    echo -e "${RED}❌ wrangler.json not found${NC}"
    exit 1
fi

if [ ! -f "src/index.ts" ]; then
    echo -e "${RED}❌ src/index.ts not found${NC}"
    exit 1
fi

if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Configuration files found${NC}"

# Check TypeScript configuration
echo -e "${BLUE}📋 Checking TypeScript configuration...${NC}"
if npx tsc --noEmit &> /dev/null; then
    echo -e "${GREEN}✅ TypeScript configuration valid${NC}"
else
    echo -e "${YELLOW}⚠️  TypeScript validation issues found${NC}"
    echo "Run 'npm run typegen' to regenerate types"
fi

# Check D1 database configuration
echo -e "${BLUE}📊 Checking D1 database configuration...${NC}"
DB_ID=$(grep -o '"database_id": "[^"]*"' wrangler.json | cut -d'"' -f4 2>/dev/null || echo "")
if [ -z "$DB_ID" ] || [ "$DB_ID" = "ad825428-5f0d-4d0b-878b-45b94e3c9c63" ]; then
    echo -e "${YELLOW}⚠️  Default database ID detected${NC}"
    echo "Run 'npm run setup' to create and configure D1 database"
else
    echo -e "${GREEN}✅ D1 database configured: ${DB_ID}${NC}"
fi

# Check R2 bucket configuration
echo -e "${BLUE}🪣 Checking R2 bucket configuration...${NC}"
R2_BUCKET=$(grep -o '"bucket_name": "[^"]*"' wrangler.json | cut -d'"' -f4 2>/dev/null || echo "")
if [ -n "$R2_BUCKET" ]; then
    echo -e "${GREEN}✅ R2 bucket configured: ${R2_BUCKET}${NC}"
else
    echo -e "${YELLOW}⚠️  R2 bucket not configured${NC}"
    echo "Run 'npm run setup' to create and configure R2 bucket"
fi

# Check development environment
echo -e "${BLUE}🔧 Checking development environment...${NC}"
if [ -f ".dev.vars" ]; then
    echo -e "${GREEN}✅ Development environment configured${NC}"
else
    echo -e "${YELLOW}⚠️  Development environment not configured${NC}"
    echo "Run 'npm run setup' to create .dev.vars file"
fi

# Test development server (quick test)
echo -e "${BLUE}🧪 Testing development server...${NC}"
if timeout 5s npm run dev > /tmp/dev-test.log 2>&1; then
    echo -e "${GREEN}✅ Development server can start${NC}"
else
    if grep -q "Ready on" /tmp/dev-test.log; then
        echo -e "${GREEN}✅ Development server ready${NC}"
    else
        echo -e "${YELLOW}⚠️  Development server test inconclusive${NC}"
        echo "Try running 'npm run dev' manually to test"
    fi
fi

# Clean up
rm -f /tmp/dev-test.log

# Summary
echo ""
echo -e "${GREEN}🎉 Health check complete!${NC}"
echo ""
echo -e "${BLUE}Quick Start Commands:${NC}"
echo "• Setup Cloudflare Workers: ${YELLOW}npm run setup${NC}"
echo "• Start development: ${YELLOW}npm run dev${NC}"
echo "• View logs: ${YELLOW}npm run cf:logs${NC}"
echo "• Deploy to production: ${YELLOW}npm run deploy:production${NC}"
echo ""

# Check if setup is needed
NEEDS_SETUP=false
if [ -z "$DB_ID" ] || [ "$DB_ID" = "ad825428-5f0d-4d0b-878b-45b94e3c9c63" ]; then
    NEEDS_SETUP=true
fi
if [ ! -f ".dev.vars" ]; then
    NEEDS_SETUP=true
fi

if [ "$NEEDS_SETUP" = true ]; then
    echo -e "${YELLOW}💡 Run 'npm run setup' to complete the configuration${NC}"
else
    echo -e "${GREEN}✅ Your CMS is ready! Run 'npm run dev' to start developing${NC}"
fi

echo ""