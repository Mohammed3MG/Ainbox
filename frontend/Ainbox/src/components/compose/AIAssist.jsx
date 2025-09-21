import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Sparkles, X, ArrowDown, Loader2, Lightbulb, Brain } from 'lucide-react';
import { cn } from '../../lib/utils';

const EMAIL_SUGGESTIONS = [
  {
    title: "Professional Follow-up",
    prompt: "Write a professional follow-up email to check on the status of a previous request or meeting"
  },
  {
    title: "Meeting Request",
    prompt: "Compose a polite email requesting a meeting to discuss project details or collaboration"
  },
  {
    title: "Thank You Note",
    prompt: "Write a sincere thank you email expressing appreciation for someone's help or time"
  },
  {
    title: "Project Update",
    prompt: "Create a clear project status update email for stakeholders with current progress and next steps"
  },
  {
    title: "Apology Email",
    prompt: "Write a professional apology email taking responsibility and offering solutions"
  },
  {
    title: "Introduction Email",
    prompt: "Compose a warm introduction email to connect two parties or introduce yourself"
  },
  {
    title: "Deadline Reminder",
    prompt: "Write a friendly but firm reminder about an upcoming deadline or commitment"
  },
  {
    title: "Proposal Submission",
    prompt: "Create a professional email submitting a proposal or recommendation with key highlights"
  }
];

export default function AIAssist({ onInsert, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [generatedText, setGeneratedText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const promptRef = useRef(null);

  useEffect(() => {
    // Focus the prompt input when opened
    promptRef.current?.focus();
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      promptRef.current?.focus();
      return;
    }

    setIsGenerating(true);
    setError('');
    setGeneratedText('');

    try {
      const response = await fetch('/ai/generate-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setGeneratedText(data.email);

    } catch (err) {
      console.error('AI generation error:', err);

      if (err.name === 'AbortError' || err.message.includes('timeout')) {
        setError('AI generation is taking longer than usual. The model might be loading. Please try again in a moment.');
      } else if (err.message.includes('Failed to connect') || err.message.includes('ECONNREFUSED')) {
        setError('AI service is currently unavailable. Please make sure Ollama is running with the llama3 model.');
      } else if (err.message.includes('500') || err.message.includes('Internal Server Error')) {
        setError('AI generation failed. This might be due to model loading time. Please try again.');
      } else {
        setError('Failed to generate email content. Please try again.');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleInsert = () => {
    if (generatedText) {
      onInsert(generatedText);
      onClose(); // Close AI panel after inserting
    }
  };

  const handleSuggestionClick = (suggestion) => {
    setPrompt(suggestion.prompt);
    promptRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleGenerate();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="absolute inset-0 bg-white border border-gray-200 rounded-t-lg shadow-xl animate-in slide-in-from-bottom-2 duration-200 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-blue-50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-blue-700" />
          </div>
          <h3 className="text-lg font-semibold text-blue-900">Write with Fyl AI Assistant</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="p-1 h-8 w-8 hover:bg-blue-100"
          aria-label="Close AI Assist"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Chat Container */}
      <div className="flex flex-col flex-1 min-h-0">
        {/* Suggestions - Top (Hidden when generating or content exists) */}
        {!isGenerating && !generatedText && !error && (
          <div className="p-4 border-b border-gray-100 flex-shrink-0 animate-in fade-in duration-200">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="w-4 h-4 text-blue-700" />
              <span className="text-sm font-medium text-gray-700">Quick Suggestions</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {EMAIL_SUGGESTIONS.slice(0, 4).map((suggestion, index) => (
                <Button
                  key={index}
                  variant="outline"
                  size="sm"
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="text-xs h-auto py-2 px-3 text-left justify-start hover:bg-blue-50 border-blue-200"
                  disabled={isGenerating}
                >
                  {suggestion.title}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Chat Messages Area - Middle (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {/* Welcome message when no content and no suggestions shown */}
          {!generatedText && !isGenerating && !error && (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-3">
                <Sparkles className="w-6 h-6 text-blue-700" />
              </div>
              <p className="text-sm text-gray-600 max-w-md">
                Describe what you want to write in the text box below and I'll generate a professional email for you.
              </p>
            </div>
          )}

          {/* Generated content appears here */}
          {(generatedText || isGenerating) && (
            <div className="space-y-3">
              {/* AI Response Bubble */}
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-blue-700" />
                </div>
                <div className="flex-1 max-w-full">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-blue-900">Generatd with Fyl</span>
                      {isGenerating && (
                        <div className="flex items-center text-blue-700">
                          {/* <Sparkles className="w-4 h-4 animate-spin text-purple-600 drop-shadow-sm" /> */}
                          {/* <Brain className="w-4 h-4 animate-pulse text-blue-600" /> */}
                          <Sparkles className="w-4 h-4 animate-pulse drop-shadow-lg text-blue-700" />
                          Writing...
                        </div>
                      )}
                    </div>
                    <div className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">
                      {generatedText}
                      {isGenerating && <span className="animate-pulse">|</span>}
                    </div>

                    {generatedText && !isGenerating && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-blue-200">
                        <Button
                          onClick={handleInsert}
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-1"
                        >
                          <ArrowDown className="w-3 h-3" />
                          Insert
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleGenerate}
                          disabled={!prompt.trim()}
                          className="text-blue-600 border-blue-200 hover:bg-blue-50"
                        >
                          <Sparkles className="w-3 h-3 mr-1" />
                          Regenerate
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setGeneratedText('');
                            setPrompt('');
                            promptRef.current?.focus();
                          }}
                          className="text-gray-600"
                        >
                          Clear
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                <X className="w-4 h-4 text-red-600" />
              </div>
              <div className="flex-1">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <span className="text-sm font-medium text-red-900 block mb-1">Error</span>
                  <span className="text-sm text-red-700">{error}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input Area - Bottom (Fixed) */}
        <div className="p-4 border-t border-gray-200 bg-white flex-shrink-0">
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Textarea
                  ref={promptRef}
                  id="ai-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe what you want to write... (Ctrl+Enter to send)"
                  className="min-h-16 max-h-32 resize-none border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                  disabled={isGenerating}
                />
              </div>
              <Button
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 h-16"
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
              </Button>
            </div>
            <div className="text-xs text-gray-500 text-center">
              Press Ctrl+Enter to generate • Use suggestions above for quick starts
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}