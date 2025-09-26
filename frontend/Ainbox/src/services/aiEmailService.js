import { apiFetch } from './apiClient';

// AI Email Service for conversational email generation
export class AIEmailService {
  async generateEmail(prompt, conversationContext = {}) {
    try {
      console.log('🤖 Generating email with AI service');
      console.log('📝 Prompt:', prompt);
      console.log('💬 Conversation context:', conversationContext);

      const response = await apiFetch('/ai/generate-email', {
        method: 'POST',
        body: {
          prompt: prompt.trim(),
          conversation: conversationContext,
          model: 'gemma2:2b',
          maxTokens: 200,
          temperature: 0.3
        }
      });

      if (response.success) {
        return {
          success: true,
          emailContent: response.emailContent,
          explanation: response.explanation,
          suggestions: response.suggestions || [],
          conversationId: response.conversationId,
          timestamp: response.timestamp
        };
      } else {
        throw new Error(response.error || 'AI generation failed');
      }

    } catch (error) {
      console.error('❌ AI email generation failed:', error);

      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Request timeout - AI service is taking too long to respond',
          fallback: true
        };
      }

      if (error.status === 500) {
        return {
          success: false,
          error: 'AI service temporarily unavailable',
          details: error.payload?.note || 'Please check if Ollama is running',
          fallback: true
        };
      }

      return {
        success: false,
        error: error.message || 'Failed to generate email',
        fallback: true
      };
    }
  }

  createMockResponse(prompt) {
    const mockEmails = [
      {
        content: `Dear [Name],\n\nI hope this message finds you well. ${prompt.toLowerCase().includes('professional') ? 'I am writing to formally address your inquiry.' : 'I wanted to reach out regarding your request.'}\n\nPlease let me know if you need any additional information.\n\nBest regards,`,
        explanation: `Generated a ${prompt.toLowerCase().includes('professional') ? 'professional' : 'friendly'} email based on your request.`
      },
      {
        content: `Hi [Name],\n\nThank you for your message. ${prompt.toLowerCase().includes('urgent') ? 'I understand this is time-sensitive and will prioritize accordingly.' : 'I appreciate you taking the time to get in touch.'}\n\nI look forward to your response.\n\nThanks,`,
        explanation: `Crafted an email with ${prompt.toLowerCase().includes('urgent') ? 'urgent' : 'standard'} tone as requested.`
      }
    ];

    const selected = mockEmails[Math.floor(Math.random() * mockEmails.length)];

    return {
      success: true,
      emailContent: selected.content,
      explanation: selected.explanation,
      suggestions: [
        "Make it more professional",
        "Make it shorter",
        "Add more details",
        "Change to casual tone"
      ],
      conversationId: Date.now().toString(),
      timestamp: new Date().toISOString(),
      isMock: true
    };
  }
}

export default new AIEmailService();