# Al Ummah Now CMS

A content management system for www.alummahnow.net running on Cloudflare Workers, built with the bknd framework.

![Al Ummah Now CMS Homepage](https://github.com/user-attachments/assets/eed620a1-3bed-40a1-88af-2627d464cbfb)

## Features

✅ **Content Management**
- Articles entity with title, content, and published status
- Rich admin interface for content creation and editing
- Real-time content management through bknd interface

✅ **Public API**
- REST API endpoints for public content delivery
- JSON API at `/api/articles` and `/api/articles/:id`
- Filtered content (only published articles)

✅ **Infrastructure**
- Built on Cloudflare Workers for global edge performance
- D1 database for content storage
- R2 bucket for media files and static assets
- bknd framework for rapid backend development

✅ **Design & Theme**
- Al Ummah Now branded design with logo integration
- Purple gradient theme matching the community brand
- Responsive design for mobile and desktop
- Modern, clean interface

✅ **Authentication Ready**
- Configured for OpenAuth integration with auth.alummahnow.net
- Extensible authentication system

## Project Structure

```
/
├── src/
│   └── index.ts          # Main application with CMS logic
├── package.json          # Node.js dependencies
├── wrangler.json         # Cloudflare Workers configuration
├── tsconfig.json         # TypeScript configuration
├── .env.example          # Environment configuration template
└── README.md            # This file
```

## Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .dev.vars
   # Edit .dev.vars with your configuration
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   ```
   Access the CMS at http://localhost:8787

4. **Access Admin Interface**
   - Navigate to `/data` for content management
   - Create and edit articles through the admin interface
   - Manage entities and database schema

## API Endpoints

- **Homepage**: `/` - Public website with Al Ummah Now branding
- **Articles API**: `/api/articles` - JSON API for all published articles  
- **Single Article**: `/api/articles/:id` - JSON API for specific article
- **Admin Dashboard**: `/data` - Content management interface
- **Media Manager**: `/media` - File and media management
- **Authentication**: `/auth` - User authentication system

## Content Management

![Admin Interface](https://github.com/user-attachments/assets/17176040-10a8-40c7-b17b-37b49ebc24f8)

The CMS includes a complete admin interface for:
- Creating and editing articles
- Managing content publication status
- Database schema management
- Media file uploads and management
- User authentication and permissions

## Deployment

### Prerequisites

1. **Cloudflare Account**: Set up a Cloudflare account and get your Account ID
2. **Domain Setup**: Configure www.alummahnow.net in Cloudflare
3. **D1 Database**: Create a D1 database instance
4. **R2 Bucket**: Create an R2 bucket for media storage

### Deployment Steps

1. **Configure Cloudflare Credentials**
   ```bash
   npx wrangler login
   ```

2. **Create D1 Database**
   ```bash
   npx wrangler d1 create al-ummah-now-cms
   ```
   Update the `database_id` in `wrangler.json` with the returned ID.

3. **Create R2 Bucket**
   ```bash
   npx wrangler r2 bucket create al-ummah-now-cms
   ```

4. **Deploy to Production**
   ```bash
   npm run deploy
   ```

5. **Configure Custom Domain**
   - Add www.alummahnow.net as a custom domain in Cloudflare Workers
   - Update DNS records to point to your Worker

## Authentication Setup

To integrate with auth.alummahnow.net:

1. Configure the authentication server endpoints in `src/index.ts`
2. Set up OAuth credentials in your environment variables
3. Update the `AUTH_CLIENT_ID` and `AUTH_CLIENT_SECRET` in your production environment

## Development Commands

| Command           | Action                                                   |
|:------------------|:---------------------------------------------------------|
| `npm install`     | Install dependencies                                     |
| `npm run dev`     | Start local development server at `localhost:8787`      |
| `npm run typegen` | Generate TypeScript types for Cloudflare bindings       |
| `npm run deploy`  | Deploy to Cloudflare Workers                             |

## Technology Stack

- **Framework**: [bknd](https://docs.bknd.io/) - Full-stack backend framework
- **Runtime**: Cloudflare Workers - Serverless edge computing
- **Database**: Cloudflare D1 - SQLite database at the edge
- **Storage**: Cloudflare R2 - Object storage for media files
- **Frontend**: Server-side rendered HTML with modern CSS
- **TypeScript**: Full type safety and modern JavaScript features

## Contributing

This CMS is built specifically for the Al Ummah Now community. For feature requests or improvements:

1. Test your changes locally with `npm run dev`
2. Ensure the admin interface remains functional
3. Verify API endpoints work correctly
4. Check responsive design on mobile devices

## Support

For questions about the CMS implementation or bknd framework:
- Check [bknd documentation](https://docs.bknd.io/integration/cloudflare)
- Join the [bknd Discord server](https://discord.gg/952SFk8Tb8)

---

*Built with ❤️ for the Al Ummah Now community*
