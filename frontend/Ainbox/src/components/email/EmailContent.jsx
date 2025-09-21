import React, { useState, useEffect, useRef } from 'react';
import { Button } from '../ui/button';

/**
 * Robust email content renderer with security and format handling
 */
export default function EmailContent({ threadId, messageId, allowRemoteImages: initialAllowRemoteImages = false }) {
  const [emailContent, setEmailContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [allowRemoteImages, setAllowRemoteImages] = useState(initialAllowRemoteImages);
  const [height, setHeight] = useState(420);
  const iframeRef = useRef(null);

  // Load email content
  useEffect(() => {
    loadEmailContent();
  }, [messageId, allowRemoteImages]);

  // Handle iframe height adjustment
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const onLoad = () => {
      try {
        const doc = iframe.contentWindow?.document;
        if (!doc) return;
        const newHeight = Math.min(3000, Math.max(240, doc.body?.scrollHeight || 420));
        setHeight(newHeight);
      } catch (error) {
        // Cross-origin error is expected with sandboxed iframe
        console.debug('Cannot access iframe content (expected with sandbox)');
      }
    };

    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [emailContent]);

  const loadEmailContent = async () => {
    if (!messageId) return;

    setLoading(true);
    setError(null);

    try {
      console.log('📧 Loading robust email content for:', messageId);
      console.log('📧 Making request to:', `/emails/${messageId}/content?allowRemoteImages=${allowRemoteImages}`);

      const response = await fetch(`/emails/${messageId}/content?allowRemoteImages=${allowRemoteImages}`);
      console.log('📧 Response received:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        url: response.url
      });

      if (!response.ok) {
        throw new Error(`Failed to load email content: ${response.status} ${response.statusText}`);
      }

      console.log('📧 About to parse response as JSON...');
      const responseText = await response.text();
      console.log('📧 Raw response text (first 200 chars):', responseText.substring(0, 200));

      const content = JSON.parse(responseText);

      console.log('📧 Email content loaded:', {
        subject: content.subject,
        hasHtml: content.hasHtml,
        inlineCidCount: content.inlineCidCount,
        attachmentCount: content.attachments?.length || 0
      });

      setEmailContent(content);

    } catch (error) {
      console.error('❌ Failed to load email content:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadRemoteImages = () => {
    setAllowRemoteImages(true);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 p-8">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading email content...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 p-8">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-red-500 text-2xl">⚠️</span>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Failed to load email
          </h3>
          <p className="text-gray-500 mb-4">{error}</p>
          <Button onClick={loadEmailContent} variant="outline">
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!emailContent) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 p-8">
        <div className="text-center">
          <p className="text-gray-500">No email content available</p>
        </div>
      </div>
    );
  }

  const hasExternalImages = emailContent.srcDoc && emailContent.srcDoc.includes('blocked-remote-image');

  return (
    <div className="flex-1 bg-white flex flex-col overflow-hidden">

      {/* Remote images warning */}
      {hasExternalImages && !allowRemoteImages && (
        <div className="bg-yellow-50 border-b border-yellow-200 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="text-yellow-600 mr-2">⚠️</span>
              <span className="text-sm text-yellow-800">
                Remote images have been blocked for your privacy and security.
              </span>
            </div>
            <Button
              onClick={handleLoadRemoteImages}
              variant="outline"
              size="sm"
              className="text-yellow-700 border-yellow-300 hover:bg-yellow-100"
            >
              Load Images
            </Button>
          </div>
        </div>
      )}

      {/* Email content iframe */}
      <div className="flex-1 overflow-hidden">
        {emailContent.srcDoc ? (
          <iframe
            ref={iframeRef}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            srcDoc={emailContent.srcDoc}
            title={`email-content-${messageId}`}
            style={{
              width: '100%',
              height: `${height}px`,
              border: 'none',
              backgroundColor: '#fff'
            }}
            onError={(e) => {
              console.error('Iframe error:', e);
              setError('Failed to render email content');
            }}
          />
        ) : (
          <div className="p-8 text-center text-gray-500">
            <p>No renderable content available</p>
            {emailContent.textFallback && (
              <div className="mt-4 p-4 bg-gray-50 rounded text-left text-sm">
                <h4 className="font-medium mb-2">Text content:</h4>
                <pre className="whitespace-pre-wrap">{emailContent.textFallback}</pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Attachments section */}
      {emailContent.attachments && emailContent.attachments.length > 0 && (
        <div className="border-t border-gray-200 p-4">
          <h4 className="font-medium text-gray-900 mb-3">
            Attachments ({emailContent.attachments.length})
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {emailContent.attachments.map((attachment, index) => (
              <div
                key={attachment.id || index}
                className="flex items-center p-3 bg-gray-50 rounded-lg border"
              >
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded flex items-center justify-center mr-3">
                  <span className="text-blue-600 text-xs font-medium">
                    📎
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {attachment.filename || 'Unnamed attachment'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {attachment.size ? formatFileSize(attachment.size) : 'Unknown size'}
                    {attachment.isInline && ' (Inline)'}
                  </p>
                </div>
                {!attachment.isInline && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const url = `/emails/${messageId}/attachment/${encodeURIComponent(attachment.id)}`;
                      window.open(url, '_blank');
                    }}
                    className="flex-shrink-0 ml-2"
                  >
                    Download
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Format file size in human readable format
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}