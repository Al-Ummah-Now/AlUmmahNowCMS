# Al Ummah Now CMS - GitHub Copilot Instructions

## Project Overview

This repository contains the **Al Ummah Now CMS**, a content management system for the community website www.alummahnow.net. The CMS is built using modern web technologies and runs on Cloudflare's edge infrastructure.

### Key Technologies
- **Framework**: [bknd](https://docs.bknd.io/) - Full-stack backend framework for rapid development
- **Runtime**: Cloudflare Workers - Serverless edge computing platform
- **Database**: Cloudflare D1 - SQLite database at the edge
- **Storage**: Cloudflare R2 - Object storage for media files
- **Language**: TypeScript with full type safety
- **Frontend**: Server-side rendered HTML with modern CSS

## Architecture & Infrastructure

### Cloudflare Workers Setup
- Entry point: `src/index.ts` using bknd's Cloudflare adapter
- Configuration: `wrangler.json` defines Worker settings, D1 database, and R2 bucket bindings
- Development server runs on `http://127.0.0.1:8585` (configured port)
- Production deployment uses `wrangler deploy` command

### Database Schema
- **Articles Entity**: Core content entity with fields:
  - `id` (integer, auto-increment, primary key)
  - `title` (text, required) - Article headline
  - `content` (text) - Article body content
  - `published` (boolean) - Publication status for content visibility

### API Endpoints Structure
- **Homepage**: `/` - Public website with Al Ummah Now branding
- **Public API**: `/api/articles` - JSON endpoint for published articles
- **Single Article**: `/api/articles/:id` - JSON endpoint for individual articles
- **Admin Interface**: `/data` - bknd admin panel for content management
- **Media Manager**: `/media` - File upload and management interface
- **Authentication**: `/auth` - User authentication system
- **Debug**: `/debug` - Development endpoint for inspecting app structure

## Development Guidelines

### Code Style & Patterns
- Use TypeScript with strict type checking
- Follow bknd framework patterns for server route definitions
- Implement error handling with try-catch blocks and meaningful error messages
- Use async/await for asynchronous operations
- Maintain consistent indentation (3 spaces) as shown in existing code

### Content Management Best Practices
- All public content should be filtered by `published: true` status
- Use bknd's entity management for database operations
- Implement proper error responses with appropriate HTTP status codes
- Maintain separation between admin interfaces and public APIs

### Authentication Integration
- System is configured for OpenAuth integration with `auth.alummahnow.net`
- Environment variables for authentication should be defined in `.env` files
- Client credentials should be stored securely in Cloudflare environment variables

## Branding & Design

### Al Ummah Now Theme
- **Primary Colors**: Purple gradient (`#667eea` to `#764ba2`)
- **Logo**: Integrated from Facebook profile image URL
- **Typography**: System fonts (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto`)
- **Design Philosophy**: Modern, clean, community-focused interface

### Responsive Design Requirements
- Mobile-first approach with responsive breakpoints
- Ensure accessibility across devices
- Maintain professional appearance matching community standards
- Use modern CSS features (flexbox, grid, gradients)

## Development Workflow

### Local Development
```bash
npm install          # Install dependencies
npm run dev         # Start development server (port 8585)
npm run typegen     # Generate Cloudflare Workers types
```

### Testing & Validation
- Test admin interface at `/data` for content management functionality
- Verify API endpoints return proper JSON responses
- Check responsive design on multiple screen sizes
- Validate database operations through bknd interface

### Deployment Process
```bash
npm run deploy      # Deploy to Cloudflare Workers
```

**Prerequisites for deployment:**
- Cloudflare account with Workers access
- D1 database created and configured in `wrangler.json`
- R2 bucket created for media storage
- Environment variables configured for authentication

## File Structure Understanding

```
/
├── src/
│   └── index.ts              # Main application entry point with bknd server setup
├── .github/
│   └── copilot-instructions.md  # This file
├── package.json              # Dependencies: bknd, wrangler, TypeScript
├── wrangler.json            # Cloudflare Workers configuration with D1/R2 bindings
├── tsconfig.json            # TypeScript configuration
├── worker-configuration.d.ts # Generated Cloudflare Workers types
├── .env.example             # Environment variables template
├── .gitignore               # Standard Node.js and Cloudflare Workers ignores
└── README.md               # Comprehensive project documentation
```

## Common Development Tasks

### Adding New Content Types
1. Create entity through bknd admin interface at `/data`
2. Define fields appropriate for the content type
3. Add API endpoints in `src/index.ts` following existing patterns
4. Update frontend templates to display new content

### Modifying Homepage Design
- Homepage HTML is generated in the main route handler in `src/index.ts`
- CSS is embedded in the HTML template
- Maintain Al Ummah Now branding colors and logo integration
- Test responsive behavior across devices

### API Development
- Follow REST conventions for endpoint naming
- Return consistent JSON response structures
- Implement proper error handling with descriptive messages
- Filter content based on publication status for public endpoints

### Database Operations
- Use bknd's admin interface for schema changes
- Entity relationships should be managed through bknd configuration
- Database migrations are handled automatically by the bknd framework

## Security Considerations

- Never commit sensitive credentials to the repository
- Use Cloudflare environment variables for production secrets
- Implement proper content filtering (published vs. draft)
- Validate user inputs in API endpoints
- Follow Cloudflare Workers security best practices

## Community Context

This CMS serves the **Al Ummah Now** community, which requires:
- Professional, respectful content presentation
- Community-focused design and messaging
- Reliable content management for community announcements
- Integration with existing authentication infrastructure
- Scalable architecture to support community growth

## Troubleshooting Common Issues

### Development Server Issues
- Ensure port 8585 is available for local development
- Check that D1 database ID in `wrangler.json` is correct
- Verify R2 bucket configuration matches Cloudflare setup

### bknd Framework Issues
- Refer to [bknd documentation](https://docs.bknd.io/integration/cloudflare)
- Check bknd Discord server for community support
- Ensure bknd version compatibility with Cloudflare Workers

### Deployment Issues
- Verify Cloudflare credentials are properly configured
- Ensure all environment variables are set in Cloudflare Workers dashboard
- Check that custom domain configuration matches www.alummahnow.net

When working on this project, always consider the community impact, maintain the professional branding standards, and ensure that changes support the mission of connecting and serving the Al Ummah Now community.