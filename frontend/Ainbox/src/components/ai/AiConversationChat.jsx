import React, { useState, useRef, useEffect } from 'react';
import { useAiConversation } from '../../hooks/useAiConversation';
import aiEmailService from '../../services/aiEmailService';
import { Sparkles, Copy, Check } from 'lucide-react';
const AiConversationChat = ({ onEmailGenerated, onClose }) => {
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTone, setSelectedTone] = useState('Professional');
  const [selectedLength, setSelectedLength] = useState('Standard');
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const messagesEndRef = useRef(null);

  const {
    conversation,
    isGenerating,
    addUserMessage,
    addAiMessage,
    clearConversation,
    selectAiResponse,
    setIsGenerating,
    getSelectedEmailContent,
    getConversationContext,
    getStats,
    getDynamicSuggestions,
    quickActions
  } = useAiConversation();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  const emailTemplates = [
    { name: "Follow-up", prompt: "Write a polite follow-up email about our previous conversation", icon: "📧" },
    { name: "Thank You", prompt: "Write a professional thank you email", icon: "🙏" },
    { name: "Meeting", prompt: "Write an email requesting a meeting", icon: "📅" },
    { name: "Apology", prompt: "Write a sincere apology email", icon: "😔" },
    { name: "Introduction", prompt: "Write a professional introduction email", icon: "👋" },
    { name: "Reminder", prompt: "Write a friendly reminder email", icon: "⏰" }
  ];

  const toneOptions = ['Professional', 'Friendly', 'Formal', 'Casual'];
  const lengthOptions = ['Brief', 'Standard', 'Detailed'];

  const handleSubmit = async (prompt) => {
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);
    setIsGenerating(true);

    try {
      // Add tone and length to the prompt
      const enhancedPrompt = `${prompt}. Make it ${selectedTone.toLowerCase()} in tone and ${selectedLength.toLowerCase()} in length.`;
      addUserMessage(prompt);

      const context = getConversationContext();
      const response = await aiEmailService.generateEmail(enhancedPrompt, context);

      if (response.success) {
        addAiMessage(
          response.explanation || 'Generated email based on your request',
          response.emailContent,
          response.explanation,
          response.suggestions
        );
      } else {
        addAiMessage(
          response.error || 'Failed to generate email',
          'Sorry, I encountered an issue generating your email. Please try again.',
          response.error,
          []
        );
      }
    } catch (error) {
      console.error('Chat submission error:', error);
      addAiMessage(
        'Error generating email',
        'Sorry, something went wrong. Please try again.',
        error.message,
        []
      );
    } finally {
      setIsLoading(false);
      setIsGenerating(false);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (inputValue.trim()) {
      handleSubmit(inputValue.trim());
      setInputValue('');
    }
  };

  const handleQuickAction = (action) => {
    const currentEmail = getSelectedEmailContent();
    if (currentEmail) {
      handleSubmit(`${action}. Current email: ${currentEmail.substring(0, 200)}`);
    } else {
      handleSubmit(action);
    }
  };

  const handleTemplateClick = (template) => {
    handleSubmit(template.prompt);
  };

  const handleCopyEmail = async (content, messageId) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

const handleSelectResponse = (messageId) => {
  console.log('🔍 handleSelectResponse called with messageId:', messageId);

  // keep your selection marker
  selectAiResponse(messageId);

  // find the chosen message
  const selectedMessage = conversation.find((m) => m.id === messageId);
  console.log('📄 selectedMessage:', selectedMessage);

  // prefer the AI email body if present, otherwise fall back to message content
  const content =
    selectedMessage?.emailContent?.trim() ||
    selectedMessage?.content?.trim() ||
    "";

  console.log('📝 content to send:', content);
  console.log('🔗 onEmailGenerated function:', onEmailGenerated);

  if (content && onEmailGenerated) {
    console.log('✅ Calling onEmailGenerated with content');
    onEmailGenerated(content);   // <-- sends the AI text to your email textbox (parent handles it)
    // Close after handing content up (let React flush first)
    setTimeout(() => onClose?.(), 0);
  } else {
    console.log('❌ Missing content or onEmailGenerated function');
  }
};


  const stats = getStats();

  return (
    <div className="ai-conversation-chat h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-indigo-600 via-sky-600 to-violet-700 text-white ring-1 ring-white/10">
  <div className="flex items-center gap-3">
    <div className="p-2 rounded-lg bg-white/10 ring-1 ring-white/20">
      <Sparkles className="h-5 w-5 text-white/90" />
    </div>
    <div>
      <h5 className="text-base font-semibold">Fyl Email Assistant</h5>
      <p className="text-xs text-white/80">{stats.messageCount} messages • {stats.ageMinutes}m old</p>
    </div>
  </div>
  <div className="flex items-center gap-2">
    <button onClick={clearConversation} className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 ring-1 ring-white/20">
      Clear
    </button>
    <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 ring-1 ring-white/20">Close</button>
  </div>
</div>

      {/* Email Templates */}
      {conversation.length === 0 && (
        <div className="px-4 pt-4 pb-2 border-b border-gray-100">
          <p className="text-xs font-medium text-gray-600 mb-3">✨ Quick Templates</p>
          <div className="grid grid-cols-2 gap-2">
            {emailTemplates.map((template, index) => (
              <button
                key={index}
                onClick={() => handleTemplateClick(template)}
                disabled={isLoading}
                className="text-xs px-3 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 text-blue-700 rounded-lg border border-blue-200 hover:border-blue-300 disabled:opacity-50 transition-all duration-200 flex items-center gap-2"
              >
                <span>{template.icon}</span>
                {template.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tone & Length Controls */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-600">Tone:</span>
            <div className="flex gap-1">
              {toneOptions.map((tone) => (
                <button
                  key={tone}
                  onClick={() => setSelectedTone(tone)}
                  className={`text-xs px-2 py-1 rounded-md transition-all ${
                    selectedTone === tone
                      ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
                      : 'bg-white text-gray-600 hover:bg-gray-100 ring-1 ring-gray-200'
                  }`}
                >
                  {tone}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-600">Length:</span>
            <div className="flex gap-1">
              {lengthOptions.map((length) => (
                <button
                  key={length}
                  onClick={() => setSelectedLength(length)}
                  className={`text-xs px-2 py-1 rounded-md transition-all ${
                    selectedLength === length
                      ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-300'
                      : 'bg-white text-gray-600 hover:bg-gray-100 ring-1 ring-gray-200'
                  }`}
                >
                  {length}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {conversation.length === 0 ? (

          <div className="flex flex-col items-center justify-center text-center text-gray-500 py-8">
          <div className="p-3 rounded-full bg-gradient-to-br from-amber-300/15 to-amber-600/20 ring-1 ring-amber-500/20">
          <Sparkles className="h-10 w-10 text-amber-400" />
          </div>
          <p className="mb-2 text-4xl">Start a conversation with Fyl</p>
          <p className="text-sm">Ask me to write, edit, or improve your emails</p>
          </div>

        ) : (
          conversation.map((message) => (
          <div
  key={message.id}
  className={`mb-4 flex gap-3 ${message.type === "user" ? "justify-end" : "justify-start"}`}
>
  {/* Avatar */}
  {message.type === "ai" ? (
    <div className="shrink-0 mt-1 grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 ring-2 ring-white/50 shadow-sm">
      <Sparkles className="h-4 w-4 text-white" />
    </div>
  ) : (
    <div className="shrink-0 mt-1 grid h-8 w-8 place-items-center rounded-full bg-blue-600 text-white ring-2 ring-white/50 shadow-sm">
      <span className="text-xs font-semibold">You</span>
    </div>
  )}

  {/* Bubble */}
  <div
    className={`max-w-[75%] rounded-2xl px-4 py-3 shadow-sm ring-1 transition
      ${
        message.type === "user"
          ? "bg-blue-600 text-white ring-blue-500/30"
          : "bg-white text-slate-900 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700"
      }`}
  >
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {message.type === 'ai' && message.emailContent ? message.emailContent : message.content}
    </p>

    {/* AI action row */}
    {message.type === "ai" && message.emailContent && (
          <div className="mt-3 border-t pt-3 border-slate-200/60 dark:border-slate-700/60">
            <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSelectResponse(message.id)}
                className={`text-xs px-2.5 py-1.5 rounded-md font-medium transition-all ring-1
                  ${message.isSelected
                    ? "bg-indigo-50 text-indigo-700 ring-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-700/40"
                    : "bg-slate-50 text-slate-700 ring-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700"
                  }`}
              >
                {message.isSelected ? "✓ Selected" : "Use This"}
              </button>

              <button
                type="button"
                onClick={() => handleCopyEmail(message.emailContent, message.id)}
                className="text-xs px-2.5 py-1.5 rounded-md font-medium transition-all ring-1 bg-slate-50 text-slate-700 ring-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700 flex items-center gap-1"
              >
                {copiedMessageId === message.id ? (
                  <><Check className="h-3 w-3" /> Copied</>
                ) : (
                  <><Copy className="h-3 w-3" /> Copy</>
                )}
              </button>
            </div>


            
            </div>
          </div>
        )}
      </div>
    </div>

          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg p-3 border">
              <div className="flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full"></div>
                <span className="text-gray-600">Fyl is thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Dynamic Quick Actions */}
      {(stats.hasSelectedResponse || conversation.some(msg => msg.type === 'ai' && msg.emailContent)) && (
        <div className="px-4 py-2 border-t border-gray-100">
          <div className="flex flex-wrap gap-2">
            {(() => {
              // Get suggestions from selected message, or the most recent AI message
              let dynamicSuggestions = getDynamicSuggestions();
              if (dynamicSuggestions.length === 0) {
                const lastAiMessage = conversation.slice().reverse().find(msg => msg.type === 'ai' && msg.emailContent);
                dynamicSuggestions = lastAiMessage?.suggestions || [];
              }

              console.log('🎯 Dynamic suggestions:', dynamicSuggestions);
              console.log('📊 Stats:', stats);
              console.log('🔍 All conversation messages:', conversation.map(msg => ({
                id: msg.id,
                type: msg.type,
                hasEmailContent: !!msg.emailContent,
                suggestions: msg.suggestions
              })));
              const suggestionsToShow = dynamicSuggestions.length > 0
                ? dynamicSuggestions.slice(0, 4)
                : quickActions.slice(0, 4);

              return suggestionsToShow.map((action, index) => (
                <button
                  key={index}
                  onClick={() => handleQuickAction(action)}
                  disabled={isLoading}
                  className="text-xs px-2 py-1 bg-gradient-to-r from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 text-indigo-700 rounded-md border border-indigo-200 hover:border-indigo-300 disabled:opacity-50 transition-all duration-200"
                >
                  ✨ {action}
                </button>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleFormSubmit} className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
};

export default AiConversationChat;