import { useEffect, useRef, useState, useCallback } from 'react';

const AUTOSAVE_DELAY = 1500; // 1.5 seconds of inactivity

export function useDraftAutoSave({
  recipients,
  subject,
  content,
  attachments,
  draftId = null,
  enabled = true
}) {
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle', 'saving', 'saved', 'error'
  const [lastSaved, setLastSaved] = useState(null);
  const timeoutRef = useRef(null);
  const lastDataRef = useRef(null);

  const saveDraft = useCallback(async (data) => {
    setSaveStatus('saving');

    try {
      // Save to local storage immediately
      const localDraft = {
        id: draftId || `draft_${Date.now()}`,
        recipients: data.recipients,
        subject: data.subject,
        content: data.content,
        attachments: data.attachments.map(att => ({
          id: att.id,
          name: att.name,
          size: att.size,
          type: att.type,
          status: att.status
        })),
        lastModified: new Date().toISOString()
      };

      localStorage.setItem(`draft_${localDraft.id}`, JSON.stringify(localDraft));

      // Save to server (local database)
      const serverResponse = await fetch('/api/drafts', {
        method: draftId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: draftId,
          recipients: data.recipients,
          subject: data.subject,
          htmlContent: data.content,
          plainTextContent: stripHtml(data.content),
          attachments: data.attachments.filter(att => att.status === 'complete').map(att => ({
            id: att.id,
            name: att.name,
            size: att.size,
            type: att.type
          }))
        })
      });

      if (!serverResponse.ok) {
        throw new Error('Failed to save to server');
      }

      // Save to Gmail drafts
      if (data.recipients.to.length > 0 || data.subject || data.content) {
        try {
          await fetch('/api/gmail/drafts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              to: data.recipients.to.map(r => r.email).join(','),
              cc: data.recipients.cc.map(r => r.email).join(','),
              bcc: data.recipients.bcc.map(r => r.email).join(','),
              subject: data.subject,
              htmlContent: data.content,
              plainTextContent: stripHtml(data.content),
              attachments: data.attachments.filter(att => att.status === 'complete')
            })
          });
        } catch (gmailError) {
          console.warn('Failed to save Gmail draft:', gmailError);
          // Don't fail the entire save for Gmail errors
        }
      }

      // TODO: Save to Outlook drafts
      // Similar implementation for Microsoft Graph API

      setSaveStatus('saved');
      setLastSaved(new Date());

    } catch (error) {
      console.error('Draft save error:', error);
      setSaveStatus('error');
    }
  }, [draftId]);

  // Debounced auto-save
  useEffect(() => {
    if (!enabled) return;

    const currentData = {
      recipients,
      subject,
      content,
      attachments
    };

    // Check if data has actually changed
    const dataString = JSON.stringify(currentData);
    if (dataString === lastDataRef.current) return;
    lastDataRef.current = dataString;

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Only save if there's meaningful content
    const hasContent = recipients.to.length > 0 ||
                       recipients.cc.length > 0 ||
                       recipients.bcc.length > 0 ||
                       subject.trim().length > 0 ||
                       content.trim().length > 0 ||
                       attachments.length > 0;

    if (hasContent) {
      timeoutRef.current = setTimeout(() => {
        saveDraft(currentData);
      }, AUTOSAVE_DELAY);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [recipients, subject, content, attachments, enabled, saveDraft]);

  // Final save function for manual triggers (like closing)
  const forceSave = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const currentData = { recipients, subject, content, attachments };
    const hasContent = recipients.to.length > 0 ||
                       recipients.cc.length > 0 ||
                       recipients.bcc.length > 0 ||
                       subject.trim().length > 0 ||
                       content.trim().length > 0 ||
                       attachments.length > 0;

    if (hasContent) {
      await saveDraft(currentData);
    }
  }, [recipients, subject, content, attachments, saveDraft]);

  return {
    saveStatus,
    lastSaved,
    forceSave
  };
}

// Helper function to strip HTML tags for plain text content
function stripHtml(html) {
  if (!html) return '';

  // Create a temporary div to parse HTML
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // Replace line breaks and paragraphs with newlines
  temp.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  temp.querySelectorAll('p').forEach(p => {
    p.insertAdjacentText('afterend', '\n\n');
  });
  temp.querySelectorAll('div').forEach(div => {
    div.insertAdjacentText('afterend', '\n');
  });

  // Get text content and clean up extra whitespace
  return temp.textContent || temp.innerText || '';
}