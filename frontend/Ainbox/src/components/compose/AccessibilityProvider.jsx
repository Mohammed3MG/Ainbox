import React, { createContext, useContext, useEffect, useState } from 'react';

const AccessibilityContext = createContext({
  highContrast: false,
  reducedMotion: false,
  screenReaderActive: false,
  announcements: [],
  announce: () => {},
  setHighContrast: () => {},
  setReducedMotion: () => {}
});

export function AccessibilityProvider({ children }) {
  const [highContrast, setHighContrast] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [screenReaderActive, setScreenReaderActive] = useState(false);
  const [announcements, setAnnouncements] = useState([]);

  // Detect system preferences
  useEffect(() => {
    // Check for prefers-reduced-motion
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(motionQuery.matches);

    const handleMotionChange = (e) => setReducedMotion(e.matches);
    motionQuery.addEventListener('change', handleMotionChange);

    // Check for high contrast
    const contrastQuery = window.matchMedia('(prefers-contrast: high)');
    setHighContrast(contrastQuery.matches);

    const handleContrastChange = (e) => setHighContrast(e.matches);
    contrastQuery.addEventListener('change', handleContrastChange);

    // Simple screen reader detection
    const checkScreenReader = () => {
      // Look for common screen reader indicators
      const hasAriaLive = document.querySelector('[aria-live]');
      const hasScreenReaderClass = document.querySelector('.sr-only, .screen-reader-text');
      setScreenReaderActive(!!hasAriaLive || !!hasScreenReaderClass);
    };

    checkScreenReader();
    const observer = new MutationObserver(checkScreenReader);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      motionQuery.removeEventListener('change', handleMotionChange);
      contrastQuery.removeEventListener('change', handleContrastChange);
      observer.disconnect();
    };
  }, []);

  // Announcement function for screen readers
  const announce = (message, priority = 'polite') => {
    const announcement = {
      id: Date.now(),
      message,
      priority,
      timestamp: new Date()
    };

    setAnnouncements(prev => [...prev, announcement]);

    // Remove announcement after 5 seconds
    setTimeout(() => {
      setAnnouncements(prev => prev.filter(a => a.id !== announcement.id));
    }, 5000);
  };

  // Apply accessibility classes to body
  useEffect(() => {
    const body = document.body;

    if (highContrast) {
      body.classList.add('high-contrast');
    } else {
      body.classList.remove('high-contrast');
    }

    if (reducedMotion) {
      body.classList.add('reduced-motion');
    } else {
      body.classList.remove('reduced-motion');
    }

    if (screenReaderActive) {
      body.classList.add('screen-reader-active');
    } else {
      body.classList.remove('screen-reader-active');
    }
  }, [highContrast, reducedMotion, screenReaderActive]);

  const value = {
    highContrast,
    reducedMotion,
    screenReaderActive,
    announcements,
    announce,
    setHighContrast,
    setReducedMotion
  };

  return (
    <AccessibilityContext.Provider value={value}>
      {children}

      {/* Live region for announcements */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        role="status"
      >
        {announcements
          .filter(a => a.priority === 'polite')
          .map(a => (
            <div key={a.id}>{a.message}</div>
          ))
        }
      </div>

      <div
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        role="alert"
      >
        {announcements
          .filter(a => a.priority === 'assertive')
          .map(a => (
            <div key={a.id}>{a.message}</div>
          ))
        }
      </div>
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility() {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error('useAccessibility must be used within an AccessibilityProvider');
  }
  return context;
}

// Hook for accessible focus management
export function useFocusManagement() {
  const [focusedElement, setFocusedElement] = useState(null);
  const [focusHistory, setFocusHistory] = useState([]);

  const saveFocus = () => {
    const active = document.activeElement;
    if (active && active !== document.body) {
      setFocusedElement(active);
      setFocusHistory(prev => [...prev.slice(-4), active]); // Keep last 5
    }
  };

  const restoreFocus = (fallback = null) => {
    if (focusedElement && document.contains(focusedElement)) {
      focusedElement.focus();
    } else if (fallback) {
      fallback.focus();
    } else if (focusHistory.length > 0) {
      // Try previous focuses
      for (let i = focusHistory.length - 1; i >= 0; i--) {
        const el = focusHistory[i];
        if (document.contains(el)) {
          el.focus();
          break;
        }
      }
    }
  };

  const trapFocus = (container) => {
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return () => {};

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    container.addEventListener('keydown', handleTabKey);
    firstElement.focus();

    return () => {
      container.removeEventListener('keydown', handleTabKey);
    };
  };

  return {
    saveFocus,
    restoreFocus,
    trapFocus,
    focusedElement,
    focusHistory
  };
}