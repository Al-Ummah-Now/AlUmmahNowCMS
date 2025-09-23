#!/bin/bash

# Al Ummah Now CMS - MCP (Model Context Protocol) Setup Script
# This script configures Claude AI integration with MCP support

set -e

echo "🤖 Setting up Claude AI and MCP integration for Al Ummah Now CMS..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if required environment variables are set
echo -e "${BLUE}🔍 Checking Claude AI configuration...${NC}"

if [ -z "$CLAUDE_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  CLAUDE_API_KEY environment variable not set${NC}"
    echo "You can get your API key from: https://console.anthropic.com/"
    echo ""
    echo "Set it in your environment:"
    echo "export CLAUDE_API_KEY=your-api-key-here"
    echo ""
    echo "Or add it to your .dev.vars file for local development:"
    echo "CLAUDE_API_KEY=your-api-key-here"
    echo ""
else
    echo -e "${GREEN}✅ CLAUDE_API_KEY is configured${NC}"
fi

# Check if dependencies are installed
echo -e "${BLUE}📦 Checking AI/MCP dependencies...${NC}"

# Check if package.json has the required dependencies
if grep -q "@anthropic-ai/sdk" package.json; then
    echo -e "${GREEN}✅ Anthropic SDK dependency found${NC}"
else
    echo -e "${YELLOW}⚠️  Anthropic SDK not found in package.json${NC}"
    echo "Installing Anthropic SDK..."
    npm install @anthropic-ai/sdk
fi

if grep -q "@modelcontextprotocol/sdk" package.json; then
    echo -e "${GREEN}✅ MCP SDK dependency found${NC}"
else
    echo -e "${YELLOW}⚠️  MCP SDK not found in package.json${NC}"
    echo "Installing MCP SDK..."
    npm install @modelcontextprotocol/sdk
fi

# Install dependencies
echo -e "${BLUE}📥 Installing dependencies...${NC}"
npm install

# Create MCP configuration directory
echo -e "${BLUE}📁 Setting up MCP configuration...${NC}"
mkdir -p config/mcp

# Create MCP server configuration
cat > config/mcp/server.json << EOF
{
  "name": "al-ummah-now-cms",
  "version": "1.0.0",
  "description": "Al Ummah Now CMS MCP Server",
  "tools": [
    {
      "name": "analyze_content",
      "description": "Analyze content for moderation and categorization"
    },
    {
      "name": "generate_content", 
      "description": "Generate content suggestions for the community"
    },
    {
      "name": "enhance_content",
      "description": "Improve existing content for better engagement"
    },
    {
      "name": "translate_content",
      "description": "Translate content to different languages"
    },
    {
      "name": "generate_seo_metadata",
      "description": "Generate SEO-optimized metadata"
    }
  ],
  "resources": [
    {
      "uri": "cms://articles",
      "name": "CMS Articles",
      "description": "All articles in the Al Ummah Now CMS"
    },
    {
      "uri": "cms://guidelines",
      "name": "Community Guidelines", 
      "description": "Al Ummah Now community guidelines and content policies"
    },
    {
      "uri": "cms://templates",
      "name": "Content Templates",
      "description": "Pre-defined content templates for different types of posts"
    }
  ],
  "prompts": [
    {
      "name": "community_content_writer",
      "description": "Generate engaging content for the Al Ummah Now community"
    },
    {
      "name": "content_moderator",
      "description": "Review content for appropriateness and alignment with community guidelines"
    },
    {
      "name": "seo_optimizer",
      "description": "Optimize content for search engines while maintaining community focus"
    }
  ]
}
EOF

echo -e "${GREEN}✅ MCP server configuration created${NC}"

# Create Claude configuration file
cat > config/mcp/claude.json << EOF
{
  "model": "claude-3-haiku-20240307",
  "maxTokens": 1000,
  "temperature": 0.7,
  "systemPrompt": "You are an AI assistant helping manage content for the Al Ummah Now Islamic community website. Always ensure content is respectful, appropriate for a diverse Muslim community, and aligns with Islamic values. Be helpful, informative, and supportive of community engagement.",
  "capabilities": {
    "contentAnalysis": true,
    "contentGeneration": true,
    "contentEnhancement": true,
    "translation": true,
    "seoOptimization": true,
    "moderation": true
  }
}
EOF

echo -e "${GREEN}✅ Claude AI configuration created${NC}"

# Update .env.example with Claude configuration
echo -e "${BLUE}📝 Updating environment configuration...${NC}"

if ! grep -q "CLAUDE_API_KEY" .env.example; then
    cat >> .env.example << EOF

# Claude AI Configuration
CLAUDE_API_KEY=your-claude-api-key-here
CLAUDE_MODEL=claude-3-haiku-20240307
CLAUDE_MAX_TOKENS=1000
CLAUDE_TEMPERATURE=0.7

# MCP Configuration
MCP_ENABLED=true
MCP_SERVER_NAME=al-ummah-now-cms
EOF
    echo -e "${GREEN}✅ Environment configuration updated${NC}"
else
    echo -e "${YELLOW}⚠️  Claude configuration already exists in .env.example${NC}"
fi

# Update .dev.vars if it exists
if [ -f ".dev.vars" ]; then
    if ! grep -q "CLAUDE_API_KEY" .dev.vars; then
        echo "" >> .dev.vars
        echo "# Claude AI Configuration" >> .dev.vars
        echo "CLAUDE_API_KEY=your-dev-claude-api-key" >> .dev.vars
        echo "MCP_ENABLED=true" >> .dev.vars
        echo -e "${GREEN}✅ Development environment updated${NC}"
    else
        echo -e "${YELLOW}⚠️  Claude configuration already exists in .dev.vars${NC}"
    fi
fi

# Generate TypeScript types
echo -e "${BLUE}📋 Generating TypeScript types...${NC}"
npm run typegen

# Test the MCP setup
echo -e "${BLUE}🧪 Testing MCP configuration...${NC}"

if [ -n "$CLAUDE_API_KEY" ]; then
    echo "Testing Claude AI connection..."
    node -e "
    const { ClaudeService } = require('./src/services/claude.ts');
    const claude = new ClaudeService({ apiKey: process.env.CLAUDE_API_KEY });
    console.log('Claude AI service initialized successfully');
    " 2>/dev/null && echo -e "${GREEN}✅ Claude AI connection test passed${NC}" || echo -e "${YELLOW}⚠️  Claude AI connection test failed (check API key)${NC}"
else
    echo -e "${YELLOW}⚠️  Skipping Claude AI connection test (no API key)${NC}"
fi

# Create test script
cat > scripts/test-mcp.js << 'EOF'
// Test script for MCP and Claude AI integration
const { MCPServer } = require('../src/services/mcp.ts');

console.log('🧪 Testing MCP Server...');

const mcpServer = new MCPServer();

// Test MCP capabilities
console.log('\n📋 MCP Capabilities:');
const capabilities = mcpServer.getCapabilities();
console.log('Tools:', capabilities.tools.length);
console.log('Resources:', capabilities.resources.length);
console.log('Prompts:', capabilities.prompts.length);

// Test tool execution
console.log('\n🔧 Testing Tool Execution:');
mcpServer.executeTool('analyze_content', {
  content: 'Test content for analysis',
  contentType: 'article'
}).then(result => {
  console.log('✅ Tool execution test passed');
  console.log('Result:', result);
}).catch(error => {
  console.log('❌ Tool execution test failed:', error.message);
});

console.log('\n🎉 MCP testing complete!');
EOF

chmod +x scripts/test-mcp.js

echo -e "${GREEN}✅ MCP test script created${NC}"

# Final instructions
echo ""
echo -e "${GREEN}🎉 Claude AI and MCP setup complete!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Set your Claude API key: ${YELLOW}export CLAUDE_API_KEY=your-api-key${NC}"
echo "2. Test the setup: ${YELLOW}npm run mcp:test${NC}"
echo "3. Start development server: ${YELLOW}npm run dev${NC}"
echo "4. Test AI endpoints at: ${YELLOW}http://127.0.0.1:8585/api/claude/*${NC}"
echo "5. Check MCP capabilities at: ${YELLOW}http://127.0.0.1:8585/api/mcp/capabilities${NC}"
echo ""
echo -e "${BLUE}Available AI Features:${NC}"
echo "• Content analysis and moderation"
echo "• AI-powered content generation"
echo "• Content enhancement and optimization"
echo "• Multi-language translation"
echo "• SEO metadata generation"
echo "• Community-focused content suggestions"
echo ""
echo -e "${BLUE}API Endpoints:${NC}"
echo "• POST /api/claude/analyze - Analyze content"
echo "• POST /api/claude/generate - Generate content"
echo "• POST /api/claude/enhance - Enhance content"
echo "• POST /api/claude/translate - Translate content"
echo "• GET /api/mcp/capabilities - MCP capabilities"
echo "• POST /api/mcp/tools/:toolName - Execute MCP tools"
echo ""
echo -e "${GREEN}Happy AI-powered content management! 🤖✨${NC}"