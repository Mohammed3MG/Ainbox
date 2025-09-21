import React, { useState, useCallback } from 'react';
import { Edit3, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import ComposeBox from './ComposeBox';
import { cn } from '../../lib/utils';

const MAX_COMPOSE_WINDOWS = 2;

export default function ComposeManager({
  className,
  onCompose // Optional callback when compose is triggered
}) {
  const [composeWindows, setComposeWindows] = useState([]);
  const [activeWindowId, setActiveWindowId] = useState(null);

  const createComposeWindow = useCallback((options = {}) => {
    if (composeWindows.length >= MAX_COMPOSE_WINDOWS) {
      // Focus the first window if at limit
      setActiveWindowId(composeWindows[0]?.id);
      return;
    }

    const newWindow = {
      id: Date.now() + Math.random(),
      isOpen: true,
      isMinimized: false,
      position: {
        bottom: 20,
        right: 20 + (composeWindows.length * 60) // Offset multiple windows
      },
      replyTo: options.replyTo || null,
      forwardEmail: options.forwardEmail || null,
      draftId: options.draftId || null
    };

    setComposeWindows(prev => [...prev, newWindow]);
    setActiveWindowId(newWindow.id);

    // Call optional callback
    onCompose?.(newWindow);

    return newWindow.id;
  }, [composeWindows, onCompose]);

  const closeComposeWindow = useCallback((windowId) => {
    setComposeWindows(prev => prev.filter(window => window.id !== windowId));
    if (activeWindowId === windowId) {
      setActiveWindowId(null);
    }
  }, [activeWindowId]);

  const minimizeComposeWindow = useCallback((windowId, shouldMinimize) => {
    setComposeWindows(prev => prev.map(window =>
      window.id === windowId
        ? { ...window, isMinimized: shouldMinimize }
        : window
    ));
  }, []);

  const focusComposeWindow = useCallback((windowId) => {
    setActiveWindowId(windowId);
    // Bring window to front (if multiple windows overlap)
    setComposeWindows(prev => {
      const window = prev.find(w => w.id === windowId);
      if (!window) return prev;

      return [
        ...prev.filter(w => w.id !== windowId),
        window
      ];
    });
  }, []);

  // Public API for external components
  const composeAPI = {
    compose: (options) => createComposeWindow(options),
    reply: (email) => createComposeWindow({ replyTo: email }),
    forward: (email) => createComposeWindow({ forwardEmail: email }),
    openDraft: (draftId) => createComposeWindow({ draftId })
  };

  return (
    <div className={cn("compose-manager", className)}>
      {/* Floating Compose Button */}
      {composeWindows.length === 0 && (
        <Button
          onClick={() => createComposeWindow()}
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl z-40 transition-all duration-200"
          aria-label="Compose new email"
        >
          <Edit3 className="w-6 h-6" />
        </Button>
      )}

      {/* Multiple Window Support */}
      {composeWindows.length > 0 && (
        <div className="fixed bottom-6 right-6 z-40">
          {/* Additional compose button when windows are open */}
          {composeWindows.length < MAX_COMPOSE_WINDOWS && (
            <Button
              onClick={() => createComposeWindow()}
              className="mb-2 h-12 w-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-200"
              aria-label="Compose another email"
            >
              <Plus className="w-5 h-5" />
            </Button>
          )}

          {/* Window switcher for minimized windows */}
          {composeWindows.some(w => w.isMinimized) && (
            <div className="space-y-1 mb-2">
              {composeWindows
                .filter(window => window.isMinimized)
                .map((window) => (
                <Button
                  key={window.id}
                  variant="outline"
                  size="sm"
                  onClick={() => minimizeComposeWindow(window.id, false)}
                  className="block w-full text-left px-3 py-2 bg-white border border-gray-300 hover:border-gray-400 shadow-sm"
                >
                  <div className="truncate text-xs">
                    {window.replyTo ? `Re: ${window.replyTo.subject || 'No Subject'}` :
                     window.forwardEmail ? `Fwd: ${window.forwardEmail.subject || 'No Subject'}` :
                     'New Message'}
                  </div>
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Compose Windows */}
      {composeWindows.map((window) => (
        <ComposeBox
          key={window.id}
          isOpen={window.isOpen}
          isMinimized={window.isMinimized}
          position={window.position}
          replyTo={window.replyTo}
          forwardEmail={window.forwardEmail}
          draftId={window.draftId}
          onClose={() => closeComposeWindow(window.id)}
          onMinimize={(shouldMinimize) => minimizeComposeWindow(window.id, shouldMinimize)}
          onFocus={() => focusComposeWindow(window.id)}
          isActive={activeWindowId === window.id}
        />
      ))}
    </div>
  );
}

// Hook for accessing compose functionality from other components
export function useCompose() {
  const [composeManager, setComposeManager] = useState(null);

  const registerComposeManager = useCallback((manager) => {
    setComposeManager(manager);
  }, []);

  const compose = useCallback((options) => {
    return composeManager?.compose(options);
  }, [composeManager]);

  const reply = useCallback((email) => {
    return composeManager?.reply(email);
  }, [composeManager]);

  const forward = useCallback((email) => {
    return composeManager?.forward(email);
  }, [composeManager]);

  const openDraft = useCallback((draftId) => {
    return composeManager?.openDraft(draftId);
  }, [composeManager]);

  return {
    registerComposeManager,
    compose,
    reply,
    forward,
    openDraft
  };
}