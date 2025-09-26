import { useState, useCallback, useRef, useEffect } from 'react';

const CONVERSATION_LIMITS = {
  maxMessages: 20,
  maxAgeMinutes: 30,
  maxStorageSize: 50000,
  autoCleanupInterval: 5 * 60 * 1000
};

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

const STORAGE_KEY = 'ai_conversation_data';

export const useAiConversation = () => {
  const [conversation, setConversation] = useState(() => {
    // Load conversation from localStorage on initialization
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Check if conversation is still valid (not expired)
        const now = Date.now();
        const cutoff = now - (CONVERSATION_LIMITS.maxAgeMinutes * 60 * 1000);
        const validMessages = parsed.filter(msg => msg.timestamp > cutoff);
        return validMessages.length > 0 ? validMessages : [];
      }
    } catch (error) {
      console.error('Failed to load conversation from localStorage:', error);
    }
    return [];
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const cleanupIntervalRef = useRef(null);

  const cleanupConversation = useCallback((messages) => {
    const now = Date.now();
    const cutoff = now - (CONVERSATION_LIMITS.maxAgeMinutes * 60 * 1000);

    return messages
      .filter(msg => msg.timestamp > cutoff)
      .slice(-CONVERSATION_LIMITS.maxMessages)
      .filter(msg => msg.content.length < 5000);
  }, []);

  const saveToLocalStorage = useCallback((messages) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (error) {
      console.error('Failed to save conversation to localStorage:', error);
    }
  }, []);

  const addMessage = useCallback((message) => {
    setConversation(prev => {
      const newMessage = {
        id: generateId(),
        timestamp: Date.now(),
        ...message
      };

      const withNew = [...prev, newMessage];
      const cleaned = cleanupConversation(withNew);
      saveToLocalStorage(cleaned);
      return cleaned;
    });
  }, [cleanupConversation, saveToLocalStorage]);

  const addUserMessage = useCallback((content) => {
    addMessage({
      type: 'user',
      content: content.trim()
    });
  }, [addMessage]);

  const addAiMessage = useCallback((content, emailContent = null, explanation = null, suggestions = null) => {
    addMessage({
      type: 'ai',
      content: explanation || content,
      emailContent: emailContent,
      suggestions: suggestions || [],
      isSelected: false
    });
  }, [addMessage]);

  const clearConversation = useCallback(() => {
    setConversation([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const selectAiResponse = useCallback((messageId) => {
    setConversation(prev => {
      const updated = prev.map(msg => ({
        ...msg,
        isSelected: msg.id === messageId && msg.type === 'ai'
      }));
      saveToLocalStorage(updated);
      return updated;
    });
  }, [saveToLocalStorage]);

  const getSelectedEmailContent = useCallback(() => {
    const selectedMessage = conversation.find(msg => msg.type === 'ai' && msg.isSelected);
    return selectedMessage?.emailContent || '';
  }, [conversation]);

  const getConversationContext = useCallback(() => {
    return {
      messages: conversation.map(msg => ({
        type: msg.type,
        content: msg.content,
        emailContent: msg.emailContent,
        timestamp: msg.timestamp
      })),
      userMessages: conversation.filter(msg => msg.type === 'user').map(msg => msg.content),
      aiResponses: conversation.filter(msg => msg.type === 'ai').map(msg => ({
        content: msg.content,
        emailContent: msg.emailContent
      })),
      messageCount: conversation.length,
      lastActivity: conversation.length > 0 ? Math.max(...conversation.map(msg => msg.timestamp)) : Date.now()
    };
  }, [conversation]);

  const getDynamicSuggestions = useCallback(() => {
    const selectedMessage = conversation.find(msg => msg.type === 'ai' && msg.isSelected);
    return selectedMessage?.suggestions || [];
  }, [conversation]);

  const getStats = useCallback(() => {
    const now = Date.now();
    const lastMessage = conversation[conversation.length - 1];
    const ageMinutes = lastMessage ? Math.round((now - lastMessage.timestamp) / 1000 / 60) : 0;

    return {
      messageCount: conversation.length,
      ageMinutes,
      shouldCleanup: conversation.length > 18,
      isStale: ageMinutes > 25,
      userMessages: conversation.filter(msg => msg.type === 'user').length,
      aiMessages: conversation.filter(msg => msg.type === 'ai').length,
      hasSelectedResponse: conversation.some(msg => msg.type === 'ai' && msg.isSelected)
    };
  }, [conversation]);

  useEffect(() => {
    cleanupIntervalRef.current = setInterval(() => {
      setConversation(prev => {
        const cleaned = cleanupConversation(prev);
        if (cleaned.length !== prev.length) {
          saveToLocalStorage(cleaned);
          return cleaned;
        }
        return prev;
      });
    }, CONVERSATION_LIMITS.autoCleanupInterval);

    return () => {
      if (cleanupIntervalRef.current) {
        clearInterval(cleanupIntervalRef.current);
      }
    };
  }, [cleanupConversation, saveToLocalStorage]);

  return {
    conversation,
    isGenerating,
    addMessage,
    addUserMessage,
    addAiMessage,
    clearConversation,
    selectAiResponse,
    setIsGenerating,
    getSelectedEmailContent,
    getConversationContext,
    getStats,
    getDynamicSuggestions,
    quickActions: [
      "Make it more professional",
      "Make it shorter",
      "Add more details",
      "Change to casual tone",
      "Add call to action",
      "Make it more urgent",
      "Fix grammar and spelling",
      "Make it friendlier"
    ]
  };
};