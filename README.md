# AlUmmahNowCMS

A modern, cloud-native content management system built on the Cloudflare ecosystem. AlUmmahNowCMS leverages Cloudflare Workers for edge computing, D1 for database operations, and R2 for file storage to provide a fast, globally distributed CMS solution.

## Features

🌍 **Global Edge Deployment** - Content delivered from 200+ Cloudflare edge locations worldwide  
⚡ **Sub-100ms Response Times** - Edge-cached responses for lightning-fast content delivery  
🔒 **Enterprise Security** - Built-in authentication, authorization, and security best practices  
📊 **Flexible Content Types** - Define custom content structures with validation  
📁 **File Management** - Integrated media upload and management with R2 storage  
🔄 **RESTful APIs** - Clean, documented APIs for headless CMS usage  
🛠️ **Developer Experience** - TypeScript-first with excellent tooling and documentation

## Architecture Overview

AlUmmahNowCMS is built on a modern serverless architecture:

- **Cloudflare Workers**: Serverless compute platform for global edge execution
- **Cloudflare D1**: SQLite-compatible serverless database
- **Cloudflare R2**: S3-compatible object storage for files and media
- **bknd Framework**: Type-safe backend framework with built-in CMS functionality

For detailed architecture information, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Quick Start

### Prerequisites

- Node.js 18+ installed
- Cloudflare account with Workers and D1 enabled
- Wrangler CLI installed (`npm install -g wrangler`)

### Installation

1. **Clone and install dependencies**
   ```bash
   git clone https://github.com/meywd/AlUmmahNowCMS.git
   cd AlUmmahNowCMS
   npm install
   ```

2. **Configure Cloudflare services**
   ```bash
   # Authenticate with Cloudflare
   wrangler login
   
   # Create D1 database (if not exists)
   npx wrangler d1 create al-ummah-now-cms
   
   # Create R2 bucket (if not exists)
   npx wrangler r2 bucket create al-ummah-now-cms
   ```

3. **Update configuration**
   - Update `wrangler.json` with your database ID and bucket name
   - Configure environment variables if needed

4. **Start development server**
   ```bash
   npm run dev
   ```
   
   The CMS will be available at `http://127.0.0.1:8585`

## Project Structure

```text
AlUmmahNowCMS/
├── src/
│   └── index.ts          # Main application entry point
├── .github/
│   └── ISSUE_TEMPLATE/   # GitHub issue templates
├── package.json          # Dependencies and scripts
├── wrangler.json         # Cloudflare Workers configuration
├── tsconfig.json         # TypeScript configuration
├── ARCHITECTURE.md       # Detailed architecture documentation
├── ROADMAP.md           # Project roadmap and planned features
└── README.md            # This file
```

## Development Commands

| Command           | Action                                                   |
|:------------------|:---------------------------------------------------------|
| `npm install`     | Install dependencies                                     |
| `npm run dev`     | Start local development server at `localhost:8585`      |
| `npm run deploy`  | Deploy to Cloudflare Workers                            |
| `npm run typegen` | Generate TypeScript types for Wrangler                  |

## Configuration

### Environment Variables

The CMS can be configured through environment variables in `wrangler.json`:

```json
{
  "vars": {
    "DB_URL": "your-database-url",
    "DB_TOKEN": "your-database-token"
  }
}
```

### Database Setup

Initialize your D1 database with the required schema:

```bash
# Run database migrations
npx wrangler d1 migrations apply al-ummah-now-cms --remote

# Or for local development
npx wrangler d1 migrations apply al-ummah-now-cms --local
```

## API Documentation

The CMS provides RESTful APIs for content management:

### Content Management
- `GET /api/v1/content` - List content items
- `POST /api/v1/content` - Create new content
- `PUT /api/v1/content/{id}` - Update content
- `DELETE /api/v1/content/{id}` - Delete content

### File Management
- `POST /api/v1/files/upload` - Upload files
- `GET /api/v1/files` - List files
- `DELETE /api/v1/files/{id}` - Delete file

### Authentication
- `POST /api/v1/auth/login` - User authentication
- `GET /api/v1/auth/me` - Current user info

For complete API documentation, visit `/api/docs` when running the development server.

## Deployment

### Production Deployment

1. **Configure production environment**
   ```bash
   # Set production environment variables
   wrangler secret put DB_TOKEN
   wrangler secret put ADMIN_PASSWORD
   ```

2. **Deploy to Cloudflare Workers**
   ```bash
   npm run deploy
   ```

3. **Configure custom domain (optional)**
   ```bash
   wrangler route add "cms.yourdomain.com/*" your-worker-name
   ```

### Environment Management

- **Development**: Local Wrangler dev server with local D1/R2
- **Staging**: Dedicated Cloudflare Workers environment
- **Production**: Production Cloudflare Workers with live D1/R2

## Contributing

We welcome contributions! Please see our contributing guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

1. Follow the installation steps above
2. Create a new branch for your feature
3. Make your changes and test locally
4. Ensure all tests pass
5. Submit a pull request

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for our development roadmap and planned features.

## Support

- 📖 **Documentation**: [Architecture](./ARCHITECTURE.md) | [Roadmap](./ROADMAP.md)
- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/meywd/AlUmmahNowCMS/issues)
- 💡 **Feature Requests**: [GitHub Issues](https://github.com/meywd/AlUmmahNowCMS/issues)
- 📧 **Contact**: Create an issue for questions and support

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [bknd](https://docs.bknd.io/) framework
- Powered by [Cloudflare Workers](https://workers.cloudflare.com/)
- Uses [Cloudflare D1](https://developers.cloudflare.com/d1/) and [R2](https://developers.cloudflare.com/r2/)

---

**Project Status**: Active Development | **Latest Version**: 0.1.0 | **Project Board**: [GitHub Projects](https://github.com/users/meywd/projects/1/views/1)
