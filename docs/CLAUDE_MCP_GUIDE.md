# Claude AI and MCP Integration Guide

## Overview

This guide covers the Claude AI integration and Model Context Protocol (MCP) configuration for the Al Ummah Now CMS. The integration provides intelligent content assistance, moderation, and enhancement capabilities.

## Features

### Claude AI Integration
- **Content Analysis**: Sentiment analysis, categorization, and moderation
- **Content Generation**: AI-powered article and announcement creation
- **Content Enhancement**: Improve existing content for better engagement
- **Translation**: Multi-language support for diverse community
- **SEO Optimization**: Generate meta descriptions and optimize content
- **Community Focus**: Tailored for Islamic community values and guidelines

### Model Context Protocol (MCP)
- **Structured Communication**: Standardized AI interaction protocol
- **Tool Definitions**: Predefined tools for content management tasks
- **Resource Management**: Access to CMS resources through standardized URIs
- **Prompt Library**: Community-specific prompts for consistent AI behavior

## Quick Setup

### 1. Install Dependencies

```bash
npm install @anthropic-ai/sdk @modelcontextprotocol/sdk
```

### 2. Configure Claude API Key

Get your API key from [Anthropic Console](https://console.anthropic.com/):

```bash
# For development
echo "CLAUDE_API_KEY=your-api-key-here" >> .dev.vars

# For production
echo "your-api-key" | wrangler secret put CLAUDE_API_KEY
```

### 3. Run MCP Setup

```bash
npm run mcp:setup
```

### 4. Test Integration

```bash
npm run mcp:test
```

## API Endpoints

### Claude AI Endpoints

#### Analyze Content
```bash
POST /api/claude/analyze
Content-Type: application/json

{
  "content": "Your content to analyze"
}
```

Response:
```json
{
  "success": true,
  "analysis": {
    "sentiment": "positive",
    "categories": ["community", "spirituality"],
    "suggestedTags": ["islamic", "community", "values"],
    "isAppropriate": true,
    "moderationNotes": "Content aligns with community guidelines"
  }
}
```

#### Generate Content
```bash
POST /api/claude/generate
Content-Type: application/json

{
  "topic": "community prayer schedule",
  "type": "announcement"
}
```

#### Enhance Content
```bash
POST /api/claude/enhance
Content-Type: application/json

{
  "title": "Current title",
  "content": "Current content to enhance"
}
```

#### Translate Content
```bash
POST /api/claude/translate
Content-Type: application/json

{
  "content": "Content to translate",
  "targetLanguage": "Arabic"
}
```

### MCP Endpoints

#### Get Capabilities
```bash
GET /api/mcp/capabilities
```

Response:
```json
{
  "tools": [
    {
      "name": "analyze_content",
      "description": "Analyze content for moderation and categorization"
    }
  ],
  "resources": [
    {
      "uri": "cms://articles",
      "name": "CMS Articles",
      "description": "All articles in the Al Ummah Now CMS"
    }
  ],
  "prompts": [
    {
      "name": "community_content_writer",
      "description": "Generate engaging content for the Al Ummah Now community"
    }
  ]
}
```

#### Execute MCP Tool
```bash
POST /api/mcp/tools/analyze_content
Content-Type: application/json

{
  "content": "Content to analyze",
  "contentType": "article"
}
```

## Available Tools

### Content Analysis
- **Tool**: `analyze_content`
- **Purpose**: Analyze content for moderation, sentiment, and categorization
- **Input**: Content text and type
- **Output**: Analysis with sentiment, categories, tags, and moderation notes

### Content Generation
- **Tool**: `generate_content`
- **Purpose**: Generate new content based on topic and type
- **Input**: Topic, content type, optional tone
- **Output**: Generated title, content, tags, and category

### Content Enhancement
- **Tool**: `enhance_content`
- **Purpose**: Improve existing content for better engagement
- **Input**: Current title and content, optional target audience
- **Output**: Enhanced title, content, and improvement suggestions

### Translation
- **Tool**: `translate_content`
- **Purpose**: Translate content to different languages
- **Input**: Content and target language
- **Output**: Translated content maintaining community tone

### SEO Optimization
- **Tool**: `generate_seo_metadata`
- **Purpose**: Generate SEO-optimized metadata
- **Input**: Title, content, optional keywords
- **Output**: Meta description and SEO recommendations

## MCP Resources

### CMS Articles
- **URI**: `cms://articles`
- **Description**: Access to all articles in the CMS
- **Format**: JSON

### Community Guidelines
- **URI**: `cms://guidelines`
- **Description**: Al Ummah Now community guidelines and content policies
- **Format**: Text

### Content Templates
- **URI**: `cms://templates`
- **Description**: Pre-defined content templates for different post types
- **Format**: JSON

### Content Categories
- **URI**: `cms://categories`
- **Description**: Available content categories and descriptions
- **Format**: JSON

## Community Prompts

### Community Content Writer
- **Purpose**: Generate engaging content aligned with Islamic values
- **Arguments**: topic (required), audience (optional)
- **Use Case**: Creating new articles and announcements

### Content Moderator
- **Purpose**: Review content for appropriateness and guidelines alignment
- **Arguments**: content (required), strict_mode (optional)
- **Use Case**: Automated content moderation

### SEO Optimizer
- **Purpose**: Optimize content for search engines while maintaining community focus
- **Arguments**: content (required), target_keywords (optional)
- **Use Case**: Improving content discoverability

### Event Announcer
- **Purpose**: Create compelling announcements for community events
- **Arguments**: event_details (required), call_to_action (optional)
- **Use Case**: Event promotion and community engagement

## Configuration

### Claude AI Settings

```typescript
interface ClaudeConfig {
  apiKey: string;
  model?: string; // default: 'claude-3-haiku-20240307'
  maxTokens?: number; // default: 1000
  temperature?: number; // default: 0.7
}
```

### MCP Server Settings

```json
{
  "name": "al-ummah-now-cms",
  "version": "1.0.0",
  "description": "Al Ummah Now CMS MCP Server",
  "capabilities": {
    "tools": true,
    "resources": true,
    "prompts": true
  }
}
```

## Development Workflow

### 1. Content Creation
```typescript
// Generate content with AI assistance
const suggestion = await claude.generateContentSuggestion(
  "community iftar event",
  "announcement"
);

// Enhance the generated content
const enhanced = await claude.enhanceContent(
  suggestion.title,
  suggestion.content
);
```

### 2. Content Moderation
```typescript
// Analyze content before publishing
const analysis = await claude.analyzeContent(userContent);

if (analysis.isAppropriate) {
  // Publish content
} else {
  // Flag for manual review
}
```

### 3. Multi-language Support
```typescript
// Translate content for diverse community
const arabicTranslation = await claude.translateContent(
  content,
  "Arabic"
);

const urduTranslation = await claude.translateContent(
  content,
  "Urdu"
);
```

## Best Practices

### Content Guidelines
- Always review AI-generated content before publishing
- Ensure content aligns with Islamic values and community guidelines
- Use appropriate tags and categories for better organization
- Include relevant translations for inclusive community engagement

### API Usage
- Implement rate limiting for AI endpoints
- Cache frequently requested translations
- Use appropriate error handling for AI service failures
- Monitor API usage and costs

### Security
- Protect Claude API keys in environment variables
- Validate all user inputs before sending to AI services
- Implement content filtering for sensitive topics
- Log AI interactions for audit purposes

## Troubleshooting

### Common Issues

1. **API Key Not Working**
   - Verify API key is correctly set in environment
   - Check Anthropic console for key status
   - Ensure key has appropriate permissions

2. **MCP Tools Not Found**
   - Run `npm run mcp:setup` to initialize tools
   - Check tool definitions in MCP server configuration
   - Verify TypeScript compilation is successful

3. **Content Analysis Failing**
   - Check content length (Claude has token limits)
   - Verify content encoding and format
   - Review error logs for specific issues

4. **Translation Issues**
   - Ensure target language is supported
   - Check content for special characters or formatting
   - Review translation quality and adjust parameters

### Debug Mode

Enable debug logging:
```bash
# Set debug environment variable
echo "DEBUG=true" >> .dev.vars

# View debug logs
npm run cf:logs
```

## Support

- **Claude AI Documentation**: https://docs.anthropic.com/
- **MCP Specification**: https://spec.modelcontextprotocol.io/
- **bknd Framework**: https://docs.bknd.io/

For project-specific issues, check the repository's issue tracker or contact the maintainers.