# Cloudflare Workers Configuration Guide

## Overview

This guide helps you configure and deploy the Al Ummah Now CMS on Cloudflare Workers with proper D1 database and R2 storage setup.

## Prerequisites

1. **Cloudflare Account** - Sign up at [cloudflare.com](https://cloudflare.com)
2. **Domain** - www.alummahnow.net configured in Cloudflare DNS
3. **Node.js** - Version 18 or higher
4. **Wrangler CLI** - Cloudflare's command-line tool

## Quick Setup

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Run Setup Script

```bash
npm run setup
```

This script will:
- Create D1 database for content storage
- Create R2 bucket for media files
- Update `wrangler.json` with correct database ID
- Generate TypeScript bindings
- Create development environment variables

### 4. Start Development

```bash
npm run dev
```

Access your CMS at: http://127.0.0.1:8585

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | Run Cloudflare Workers setup script |
| `npm run dev` | Start development server |
| `npm run deploy` | Deploy to Cloudflare Workers |
| `npm run deploy:production` | Production deployment with validation |
| `npm run typegen` | Generate TypeScript types |
| `npm run cf:login` | Login to Cloudflare |
| `npm run cf:logs` | View real-time logs |
| `npm run db:create` | Create D1 database |
| `npm run r2:create` | Create R2 bucket |
| `npm run secrets:list` | List environment secrets |

## Manual Configuration

### D1 Database Setup

```bash
# Create database
npm run db:create

# Update wrangler.json with the returned database_id
```

### R2 Bucket Setup

```bash
# Create R2 bucket for media storage
npm run r2:create
```

### Environment Variables

For local development, create `.dev.vars`:

```env
AUTH_CLIENT_ID=al-ummah-now-cms
AUTH_CLIENT_SECRET=your-dev-secret
DEV_MODE=true
```

For production, set secrets:

```bash
echo "your-production-client-id" | wrangler secret put AUTH_CLIENT_ID
echo "your-production-client-secret" | wrangler secret put AUTH_CLIENT_SECRET
```

## Configuration Files

### wrangler.json

```json
{
  "name": "al-ummah-now-cms",
  "main": "src/index.ts",
  "compatibility_date": "2025-02-04",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "al-ummah-now-cms",
      "database_id": "your-database-id-here"
    }
  ],
  "r2_buckets": [
    {
      "bucket_name": "al-ummah-now-cms",
      "binding": "al_ummah_now_cms"
    }
  ]
}
```

## Deployment

### Quick Deploy

```bash
npm run deploy:production
```

### Manual Deploy

```bash
npm run typegen
npm run deploy
```

## Troubleshooting

### Common Issues

1. **Database ID mismatch** - Run `npm run db:list` and update wrangler.json
2. **R2 bucket not found** - Run `npm run r2:create`
3. **Authentication errors** - Check `npm run secrets:list`
4. **TypeScript errors** - Run `npm run typegen`

### Debug Mode

```bash
npm run cf:logs
```

## Support

- [bknd Documentation](https://docs.bknd.io/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Reference](https://developers.cloudflare.com/workers/wrangler/)