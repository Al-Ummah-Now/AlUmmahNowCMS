// Claude AI Integration for Al Ummah Now CMS
// Provides content assistance, translation, and moderation capabilities

import Anthropic from '@anthropic-ai/sdk';

export interface ClaudeConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ContentAnalysis {
  sentiment: 'positive' | 'neutral' | 'negative';
  categories: string[];
  suggestedTags: string[];
  isAppropriate: boolean;
  moderationNotes?: string;
}

export interface ContentSuggestion {
  title: string;
  content: string;
  tags: string[];
  category: string;
}

export class ClaudeService {
  private client: Anthropic;
  private config: ClaudeConfig;

  constructor(config: ClaudeConfig) {
    this.config = {
      model: 'claude-3-haiku-20240307',
      maxTokens: 1000,
      temperature: 0.7,
      ...config
    };
    
    this.client = new Anthropic({
      apiKey: this.config.apiKey,
    });
  }

  /**
   * Analyze content for moderation and categorization
   */
  async analyzeContent(content: string): Promise<ContentAnalysis> {
    try {
      const prompt = `
Analyze the following content for the Al Ummah Now community website. This is an Islamic community platform.

Content: "${content}"

Please provide analysis in the following JSON format:
{
  "sentiment": "positive|neutral|negative",
  "categories": ["category1", "category2"],
  "suggestedTags": ["tag1", "tag2", "tag3"],
  "isAppropriate": true|false,
  "moderationNotes": "any concerns or notes"
}

Consider Islamic values and community guidelines. Categories could include: "community", "events", "education", "spirituality", "announcements", "youth", "family".
`;

      const response = await this.client.messages.create({
        model: this.config.model!,
        max_tokens: this.config.maxTokens!,
        temperature: this.config.temperature!,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
      const analysis = JSON.parse(responseText) as ContentAnalysis;
      
      return analysis;
    } catch (error) {
      console.error('Claude content analysis error:', error);
      return {
        sentiment: 'neutral',
        categories: ['general'],
        suggestedTags: [],
        isAppropriate: true,
        moderationNotes: 'Analysis failed - manual review recommended'
      };
    }
  }

  /**
   * Generate content suggestions based on topic
   */
  async generateContentSuggestion(topic: string, type: 'article' | 'announcement' | 'event' = 'article'): Promise<ContentSuggestion> {
    try {
      const prompt = `
Generate a ${type} for the Al Ummah Now community website about: "${topic}"

This should be appropriate for an Islamic community platform, engaging, and informative.

Please provide the response in the following JSON format:
{
  "title": "Engaging title for the ${type}",
  "content": "Well-written content (2-3 paragraphs)",
  "tags": ["relevant", "tags"],
  "category": "appropriate category"
}

Make sure the content is respectful, community-focused, and aligns with Islamic values.
`;

      const response = await this.client.messages.create({
        model: this.config.model!,
        max_tokens: 1500,
        temperature: 0.8,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
      const suggestion = JSON.parse(responseText) as ContentSuggestion;
      
      return suggestion;
    } catch (error) {
      console.error('Claude content generation error:', error);
      return {
        title: `${type.charAt(0).toUpperCase() + type.slice(1)} about ${topic}`,
        content: 'Content generation failed. Please write manually.',
        tags: [topic.toLowerCase()],
        category: 'general'
      };
    }
  }

  /**
   * Improve and enhance existing content
   */
  async enhanceContent(title: string, content: string): Promise<{ title: string; content: string; suggestions: string[] }> {
    try {
      const prompt = `
Enhance the following content for the Al Ummah Now community website:

Title: "${title}"
Content: "${content}"

Please provide improvements in the following JSON format:
{
  "title": "Enhanced title",
  "content": "Enhanced content with better flow and engagement",
  "suggestions": ["suggestion1", "suggestion2", "suggestion3"]
}

Make sure to:
- Improve clarity and readability
- Ensure Islamic community appropriateness
- Enhance engagement while maintaining respectful tone
- Suggest additional improvements
`;

      const response = await this.client.messages.create({
        model: this.config.model!,
        max_tokens: 2000,
        temperature: 0.6,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
      const enhancement = JSON.parse(responseText);
      
      return enhancement;
    } catch (error) {
      console.error('Claude content enhancement error:', error);
      return {
        title,
        content,
        suggestions: ['Enhancement failed - manual review recommended']
      };
    }
  }

  /**
   * Translate content to different languages
   */
  async translateContent(content: string, targetLanguage: string): Promise<string> {
    try {
      const prompt = `
Translate the following content to ${targetLanguage}, maintaining the respectful and community-appropriate tone suitable for an Islamic community website:

"${content}"

Provide only the translation without additional formatting or explanation.
`;

      const response = await this.client.messages.create({
        model: this.config.model!,
        max_tokens: 1500,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      return response.content[0].type === 'text' ? response.content[0].text : content;
    } catch (error) {
      console.error('Claude translation error:', error);
      return content;
    }
  }

  /**
   * Generate SEO-friendly meta description
   */
  async generateMetaDescription(title: string, content: string): Promise<string> {
    try {
      const prompt = `
Generate an SEO-friendly meta description (150-160 characters) for the following article from Al Ummah Now community website:

Title: "${title}"
Content: "${content}"

Provide only the meta description text, optimized for search engines and community engagement.
`;

      const response = await this.client.messages.create({
        model: this.config.model!,
        max_tokens: 200,
        temperature: 0.4,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      return response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    } catch (error) {
      console.error('Claude meta description error:', error);
      return `${title} - Read more on Al Ummah Now community website.`;
    }
  }
}