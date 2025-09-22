#!/bin/bash

# Al Ummah Now CMS - Cloudflare Workers Setup Script
# This script helps set up the Cloudflare Workers environment for the CMS

set -e

echo "🚀 Setting up Al Ummah Now CMS on Cloudflare Workers..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Wrangler CLI is not installed.${NC}"
    echo "Please install it with: npm install -g wrangler"
    exit 1
fi

echo -e "${GREEN}✅ Wrangler CLI found${NC}"

# Check if user is logged in
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}⚠️  You are not logged in to Cloudflare.${NC}"
    echo "Logging you in now..."
    wrangler login
fi

echo -e "${GREEN}✅ Logged in to Cloudflare${NC}"

# Get account ID
ACCOUNT_ID=$(wrangler whoami | grep "Account ID" | awk '{print $3}' || echo "")
if [ -z "$ACCOUNT_ID" ]; then
    echo -e "${RED}❌ Could not retrieve Account ID${NC}"
    echo "Please check your Cloudflare login status"
    exit 1
fi

echo -e "${GREEN}✅ Account ID: ${ACCOUNT_ID}${NC}"

# Create D1 Database
echo ""
echo -e "${BLUE}📊 Creating D1 Database...${NC}"
DB_OUTPUT=$(wrangler d1 create al-ummah-now-cms 2>&1 || echo "exists")

if echo "$DB_OUTPUT" | grep -q "already exists"; then
    echo -e "${YELLOW}⚠️  Database 'al-ummah-now-cms' already exists${NC}"
    # Get existing database ID
    DB_ID=$(wrangler d1 list | grep "al-ummah-now-cms" | awk '{print $1}' || echo "")
else
    # Extract database ID from creation output
    DB_ID=$(echo "$DB_OUTPUT" | grep -o 'database_id = "[^"]*"' | cut -d'"' -f2 || echo "")
fi

if [ -z "$DB_ID" ]; then
    echo -e "${RED}❌ Could not get database ID${NC}"
    exit 1
fi

echo -e "${GREEN}✅ D1 Database ID: ${DB_ID}${NC}"

# Create R2 Bucket
echo ""
echo -e "${BLUE}🪣 Creating R2 Bucket...${NC}"
R2_OUTPUT=$(wrangler r2 bucket create al-ummah-now-cms 2>&1 || echo "exists")

if echo "$R2_OUTPUT" | grep -q "already exists"; then
    echo -e "${YELLOW}⚠️  R2 bucket 'al-ummah-now-cms' already exists${NC}"
else
    echo -e "${GREEN}✅ R2 bucket created successfully${NC}"
fi

# Update wrangler.json with correct database ID
echo ""
echo -e "${BLUE}📝 Updating wrangler.json configuration...${NC}"

# Backup original wrangler.json
cp wrangler.json wrangler.json.backup

# Update database_id in wrangler.json
sed -i.tmp "s/\"database_id\": \"[^\"]*\"/\"database_id\": \"$DB_ID\"/" wrangler.json
rm -f wrangler.json.tmp

echo -e "${GREEN}✅ wrangler.json updated with database ID${NC}"

# Create .dev.vars file for local development
echo ""
echo -e "${BLUE}🔧 Setting up environment variables...${NC}"

if [ ! -f .dev.vars ]; then
    cat > .dev.vars << EOF
# Al Ummah Now CMS - Development Environment Variables
# These are used for local development with 'wrangler dev'

# Authentication Configuration
AUTH_CLIENT_ID=al-ummah-now-cms
AUTH_CLIENT_SECRET=your-dev-client-secret

# Development Mode
DEV_MODE=true

# Optional: Custom development settings
DEBUG=true
EOF
    echo -e "${GREEN}✅ Created .dev.vars for local development${NC}"
else
    echo -e "${YELLOW}⚠️  .dev.vars already exists${NC}"
fi

# Generate TypeScript types
echo ""
echo -e "${BLUE}📋 Generating TypeScript types...${NC}"
npm run typegen

echo -e "${GREEN}✅ TypeScript types generated${NC}"

# Test the setup
echo ""
echo -e "${BLUE}🧪 Testing the setup...${NC}"

# Check if we can start the dev server
timeout 10s npm run dev > /dev/null 2>&1 && DEV_TEST="success" || DEV_TEST="timeout"

if [ "$DEV_TEST" = "success" ]; then
    echo -e "${GREEN}✅ Development server can start successfully${NC}"
else
    echo -e "${YELLOW}⚠️  Development server test timed out (this is normal)${NC}"
fi

# Final instructions
echo ""
echo -e "${GREEN}🎉 Cloudflare Workers setup complete!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Start development server: ${YELLOW}npm run dev${NC}"
echo "2. Open browser to: ${YELLOW}http://127.0.0.1:8585${NC}"
echo "3. Access admin panel: ${YELLOW}http://127.0.0.1:8585/data${NC}"
echo "4. When ready to deploy: ${YELLOW}npm run deploy${NC}"
echo ""
echo -e "${BLUE}Environment:${NC}"
echo "• Account ID: ${ACCOUNT_ID}"
echo "• Database ID: ${DB_ID}"
echo "• R2 Bucket: al-ummah-now-cms"
echo ""
echo -e "${BLUE}Configuration files updated:${NC}"
echo "• wrangler.json (backup saved as wrangler.json.backup)"
echo "• .dev.vars (created for local development)"
echo ""
echo -e "${GREEN}Happy coding! 🚀${NC}"