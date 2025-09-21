# Chat-Style Compose Box

A comprehensive, accessible email compose system with rich text editing, AI assistance, and multi-provider draft syncing.

## Features

### ✨ Core Functionality
- **Chat-style interface**: Bottom-right anchored, resizable, draggable compose box
- **Multiple windows**: Support for up to 2 simultaneous compose windows
- **Minimize/Maximize**: Collapsible to compact bar with subject preview
- **Auto-save**: Saves to local storage, server DB, Gmail drafts, and Outlook drafts

### 📬 Recipients & Addressing
- **To/CC/BCC fields**: Show/hide CC/BCC on demand
- **Email chips**: Removable badges for each recipient
- **Validation**: Real-time email format validation
- **Bulk entry**: Paste multiple emails separated by commas/newlines
- **Smart parsing**: Handles "Name <email>" format

### 📝 Rich Text Editor
- **Formatting**: Bold, italic, underline, strikethrough
- **Typography**: Font size (12-24px) and font family selection
- **Colors**: Text and background color picker
- **Emojis**: Categorized emoji picker with search
- **Tables**: Visual table inserter (up to 10×10)
- **HTML output**: Clean, email-safe HTML with plain-text fallback

### 🤖 AI Assist
- **Inline generation**: Expandable AI panel within compose window
- **Streaming response**: Real-time typing animation
- **Insert at cursor**: Places generated content at current position
- **Context-aware**: Can understand reply/forward context

### 📎 Attachments
- **Drag & drop**: Visual drop zone with progress indicators
- **File validation**: Size limits, type checking, security blocking
- **Progress tracking**: Individual file upload progress bars
- **Type icons**: Visual indicators for different file types
- **Preview**: Attachment chips with remove functionality

### ⌨️ Keyboard Shortcuts
- `Ctrl+Enter`: Send email
- `Escape`: Minimize/close compose window
- `Ctrl+B/I/U`: Bold/Italic/Underline
- `C`: Compose new email (global)
- `R`: Reply to email (global)
- `F`: Forward email (global)

### ♿ Accessibility Features
- **Screen reader support**: ARIA labels, live regions, semantic markup
- **Keyboard navigation**: Full keyboard operability, focus trapping
- **High contrast**: Automatic detection and enhanced styling
- **Reduced motion**: Respects user motion preferences
- **Focus management**: Smart focus restoration and trapping

## Usage

### Basic Setup

```jsx
import { ComposeManager, AccessibilityProvider } from './components/compose';

function App() {
  return (
    <AccessibilityProvider>
      <div className="app">
        {/* Your app content */}

        <ComposeManager />
      </div>
    </AccessibilityProvider>
  );
}
```

### Using the Compose API

```jsx
import { useCompose } from './components/compose';

function EmailList() {
  const { compose, reply, forward } = useCompose();

  const handleCompose = () => {
    compose(); // Opens new compose window
  };

  const handleReply = (email) => {
    reply(email); // Opens reply window with context
  };

  const handleForward = (email) => {
    forward(email); // Opens forward window with content
  };

  return (
    <div>
      <button onClick={handleCompose}>Compose</button>
      {/* Email items with reply/forward buttons */}
    </div>
  );
}
```

### Custom Compose Window

```jsx
import { ComposeBox } from './components/compose';

function CustomCompose() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  return (
    <ComposeBox
      isOpen={isOpen}
      isMinimized={isMinimized}
      onClose={() => setIsOpen(false)}
      onMinimize={setIsMinimized}
      position={{ bottom: 20, right: 20 }}
      replyTo={selectedEmail} // Optional
      forwardEmail={selectedEmail} // Optional
      draftId={existingDraftId} // Optional
    />
  );
}
```

## API Reference

### ComposeManager Props

| Prop | Type | Description |
|------|------|-------------|
| `className` | `string` | Additional CSS classes |
| `onCompose` | `function` | Callback when compose is triggered |

### ComposeBox Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | `false` | Whether compose window is open |
| `onClose` | `function` | - | Close handler |
| `onMinimize` | `function` | - | Minimize/maximize handler |
| `isMinimized` | `boolean` | `false` | Whether window is minimized |
| `position` | `object` | `{bottom: 20, right: 20}` | Window position |
| `replyTo` | `object` | `null` | Email to reply to |
| `forwardEmail` | `object` | `null` | Email to forward |
| `draftId` | `string` | `null` | Existing draft ID |

### useCompose Hook

Returns an object with compose functions:

```javascript
const {
  compose,      // (options?) => windowId
  reply,        // (email) => windowId
  forward,      // (email) => windowId
  openDraft     // (draftId) => windowId
} = useCompose();
```

## Styling

The compose system uses Tailwind CSS classes and supports customization through CSS variables:

```css
:root {
  --compose-border: #d1d5db;
  --compose-bg: #ffffff;
  --compose-text: #111827;
  --compose-focus-ring: #3b82f6;
}
```

Import the accessibility styles:

```css
@import './components/compose/styles/accessibility.css';
```

## Server Integration

### Draft API Endpoints

The compose system expects these API endpoints:

- `POST /api/drafts` - Create new draft
- `PUT /api/drafts/:id` - Update existing draft
- `POST /api/gmail/drafts` - Save to Gmail drafts
- `POST /api/outlook/drafts` - Save to Outlook drafts
- `POST /api/upload` - Upload attachments

### Email Sending

- `POST /api/emails/send` - Send email
- `POST /api/emails/:id/send` - Send draft

## Security

- File type validation and blocking of dangerous extensions
- HTML sanitization for email content
- CSRF protection for draft operations
- Attachment virus scanning (implement server-side)

## Browser Support

- Modern browsers with ES2018+ support
- Graceful degradation for older browsers
- Progressive enhancement for accessibility features

## Performance

- Lazy loading of emoji picker and color picker
- Debounced auto-save (1.5s delay)
- Virtual scrolling for large recipient lists
- Memory cleanup on component unmount