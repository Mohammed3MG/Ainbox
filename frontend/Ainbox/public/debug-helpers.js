// Gmail Real-Time Debug Helpers
// Paste this in browser console to enable debugging

window.gmailDebug = {
  // Enable color flip debugging
  enableColorDebug() {
    window.debugEmailColors = true;
    console.log('🎨 Email color debugging enabled');
  },

  // Disable color flip debugging
  disableColorDebug() {
    window.debugEmailColors = false;
    console.log('🎨 Email color debugging disabled');
  },

  // Test Socket.IO connection
  testSocket() {
    if (window.socket) {
      console.log('🔌 Socket.IO connection:', window.socket.connected ? 'CONNECTED' : 'DISCONNECTED');
      console.log('🔌 Socket ID:', window.socket.id);
    } else {
      console.log('❌ Socket.IO not found');
    }
  },

  // Test SSE connection
  testSSE() {
    const activeConnections = performance.getEntriesByType('resource')
      .filter(entry => entry.name.includes('/stream'));
    console.log('📡 SSE connections:', activeConnections);
  },

  // Simulate email status change
  simulateEmailUpdate(emailId, isRead) {
    const event = new CustomEvent('reactEmailStatusUpdate', {
      detail: {
        emailId,
        messageId: emailId,
        isRead: !!isRead,
        changeType: isRead ? 'marked_read' : 'marked_unread',
        source: 'debug_simulation',
        timestamp: new Date().toISOString()
      }
    });
    window.dispatchEvent(event);
    console.log(`🧪 Simulated email update: ${emailId} → ${isRead ? 'READ' : 'UNREAD'}`);
  },

  // Find email elements in DOM
  findEmailElements() {
    const elements = document.querySelectorAll('[data-message-id]');
    console.log(`📧 Found ${elements.length} email elements in DOM`);
    elements.forEach(el => {
      const id = el.getAttribute('data-message-id');
      const status = el.getAttribute('data-read-status');
      const bg = window.getComputedStyle(el).backgroundColor;
      console.log(`  - ${id}: ${status} (bg: ${bg})`);
    });
    return elements;
  },

  // Check email list state
  checkEmailState() {
    // This will need to be called from React component context
    console.log('📝 Check React DevTools for email state');
    console.log('💡 Or use: React.useEffect(() => console.log(emails), [emails])');
  },

  // Quick test of all debugging features
  runAllTests() {
    console.log('🧪 Running all Gmail debug tests...');
    this.enableColorDebug();
    this.testSocket();
    this.testSSE();
    this.findEmailElements();
    console.log('✅ Debug tests complete');
  }
};

// Auto-enable debugging
window.gmailDebug.enableColorDebug();

console.log('🔧 Gmail Debug Helpers loaded!');
console.log('📋 Available commands:');
console.log('  - window.gmailDebug.runAllTests()');
console.log('  - window.gmailDebug.simulateEmailUpdate("email-id", true/false)');
console.log('  - window.gmailDebug.findEmailElements()');
console.log('  - window.gmailDebug.testSocket()');