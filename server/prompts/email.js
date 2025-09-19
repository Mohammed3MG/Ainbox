function summarizePrompt(subject, messages) {
  const clip = (s, n=4000) => (s || '').slice(0, n);

  // Build conversation timeline with context
  const timeline = messages.map((m, i) => {
    const isFirst = i === 0;
    const isLast = i === messages.length - 1;
    const direction = isFirst ? '📤 ORIGINAL' : isLast ? '📥 LATEST' : '💬 REPLY';
    const content = clip(m.html || m.text || '');
    const messageNum = `Message ${i + 1}/${messages.length}`;

    return `${direction} ${messageNum} | From: ${m.from || 'unknown'} | ${m.date || ''}\n${content || '[No content]'}`;
  }).join('\n\n' + '─'.repeat(50) + '\n\n');

  console.log(`📧 Processing ${messages.length} messages for summarization`);

  // Detect conversation type
  const hasQuestions = messages.some(m => (m.html || m.text || '').includes('?'));
  const hasDeadlines = messages.some(m => /(deadline|due|by |until |before )/i.test(m.html || m.text || ''));
  const hasMeetings = messages.some(m => /(meeting|call|schedule|available)/i.test(m.html || m.text || ''));

  let contextHints = [];
  if (hasQuestions) contextHints.push('Questions need answers');
  if (hasDeadlines) contextHints.push('Timeline/deadline involved');
  if (hasMeetings) contextHints.push('Scheduling/meeting coordination');

  return [
    {
      role: 'system',
      content: `You are an expert email assistant helping busy professionals. Create crisp, actionable summaries that highlight what matters most. Use emojis for visual clarity. Format with bullet points and clear sections.`
    },
    {
      role: 'user',
      content: `📧 **Email Thread Analysis**

**Subject:** ${subject || '(no subject)'}
**Context Clues:** ${contextHints.join(', ') || 'General correspondence'}
**Messages:** ${messages.length} messages

**CONVERSATION TIMELINE:**
${timeline}

**Task:** Create a comprehensive summary of the ENTIRE conversation thread above.

⚠️ **IMPORTANT**: You must analyze and include information from ALL ${messages.length} messages in the timeline above, not just the latest message.

🎯 **Executive Summary** (1 sentence - what's this entire conversation about?)

📋 **Key Points from All Messages**
- What each person said/contributed
- Main discussion points across the thread
- Important information shared by all participants
- Current status/situation

⚡ **Action Items & Next Steps**
- Who needs to do what (from any message)
- When (deadlines/timelines mentioned anywhere)
- Outstanding questions or requests

🤝 **Decisions Made**
- What was agreed upon throughout the conversation
- What was resolved or decided
- Next steps mentioned by anyone

💬 **Conversation Flow**
- How the discussion evolved
- Key exchanges between participants
- Any changes in direction or decisions

Keep it comprehensive but under 200 words. Use emojis and bullet points for clarity. ENSURE you reference details from multiple messages, not just one.`
    }
  ];
}

function suggestRepliesPrompt(subject, lastMessage, { tone = 'neutral', fullThread = [], currentUserEmail = '', replyToSender = '', replyToEmail = '' } = {}) {
  const clip = (s, n=3000) => (s || '').slice(0, n);

  // Analyze the conversation context
  const threadContext = fullThread.length > 1 ?
    fullThread.slice(-3).map((m, i) => `[${i === fullThread.length - 1 ? 'LATEST' : 'PREVIOUS'}] ${m.from}: ${clip(m.html || m.text || '')}`).join('\n\n') :
    '';

  // Detect email intent and type
  const lastContent = lastMessage?.html || lastMessage?.text || '';
  const isQuestion = lastContent.includes('?');
  const hasRequest = /(please|can you|could you|would you|need|require)/i.test(lastContent);
  const hasDeadline = /(deadline|due|by |until |asap|urgent)/i.test(lastContent);
  const isMeeting = /(meeting|call|schedule|available|calendar)/i.test(lastContent);
  const isThankYou = /(thank|thanks|appreciate)/i.test(lastContent);
  const isUpdate = /(update|status|progress|fyi|heads up)/i.test(lastContent);

  // Determine email category
  let category = 'general';
  let replyHints = [];

  if (isThankYou) {
    category = 'acknowledgment';
    replyHints = ['Acknowledge gratitude', 'Offer continued support', 'Close professionally'];
  } else if (isMeeting) {
    category = 'scheduling';
    replyHints = ['Provide availability', 'Suggest alternatives', 'Confirm details'];
  } else if (hasRequest) {
    category = 'request';
    replyHints = ['Address the request directly', 'Provide timeline', 'Ask clarifying questions if needed'];
  } else if (isQuestion) {
    category = 'question';
    replyHints = ['Answer the question', 'Provide additional context', 'Offer follow-up'];
  } else if (isUpdate) {
    category = 'update';
    replyHints = ['Acknowledge the update', 'Share relevant information', 'Confirm next steps'];
  }

  const urgencyLevel = hasDeadline ? 'high' : 'normal';
  const relationshipTone = tone === 'formal' ? 'professional' : 'collaborative';

  // Extract first name from sender for personal addressing
  const senderFirstName = replyToSender ? replyToSender.split(' ')[0].replace(/[^\w]/g, '') : 'there';
  const replyingFrom = currentUserEmail ? currentUserEmail.split('@')[0] : 'User';

  return [
    {
      role: 'system',
      content: `You are an expert email assistant helping users craft perfect replies. You understand business communication, relationship dynamics, and professional etiquette. Generate replies that sound natural, address the sender's needs, and maintain appropriate tone. IMPORTANT: The user is replying TO the sender, not from the sender. Address the sender by name and write from the perspective of the replying user.`
    },
    {
      role: 'user',
      content: `📧 **Smart Reply Generation Request**

**Reply Context:**
- User Replying: ${currentUserEmail || replyingFrom}
- Replying TO: ${replyToSender || 'Unknown sender'} (${replyToEmail || 'unknown email'})
- Sender's First Name: ${senderFirstName}
- Subject: ${subject || '(no subject)'}

**Email Analysis:**
- Category: ${category.toUpperCase()}
- Urgency: ${urgencyLevel}
- Contains Question: ${isQuestion ? 'Yes' : 'No'}
- Has Request: ${hasRequest ? 'Yes' : 'No'}
- Meeting Related: ${isMeeting ? 'Yes' : 'No'}

**Conversation Context:**
${threadContext || 'Single message (no prior context)'}

**Latest Message from ${replyToSender || 'sender'} to Reply To:**
Content: ${clip(lastContent)}

**Reply Strategy:** ${replyHints.join(', ')}
**Desired Tone:** ${relationshipTone}

**Task:** Generate 3 contextually appropriate reply options that address ${senderFirstName}:

**Option 1: Quick & Professional** (1-2 sentences, direct response)
- Start with "Hi ${senderFirstName}," or "Dear ${senderFirstName},"
- Address their main point immediately
- Professional but efficient

**Option 2: Detailed & Thorough** (3-4 sentences, comprehensive)
- Start with "Hi ${senderFirstName}," or appropriate greeting
- Address all aspects of their message
- Provide additional context/details
- Proactive communication

**Option 3: Collaborative & Friendly** (2-3 sentences, relationship-focused)
- Start with "Hi ${senderFirstName}," or warm greeting
- Warmer tone while remaining professional
- Include offer for further assistance
- Build relationship

🎯 **CRITICAL REQUIREMENTS:**
✅ ALWAYS start with greeting ${senderFirstName} by name
✅ Write from YOUR perspective replying TO ${senderFirstName}
✅ Directly address THEIR message/request
✅ Sound like a real person (not AI-generated)
✅ Be actionable and clear
✅ Match the relationship tone
✅ Include appropriate closing
✅ DO NOT write as if you ARE ${senderFirstName} - you are REPLYING to them

Format each option clearly with "## Option 1", "## Option 2", "## Option 3" headers.`
    }
  ];
}

module.exports = { summarizePrompt, suggestRepliesPrompt };

