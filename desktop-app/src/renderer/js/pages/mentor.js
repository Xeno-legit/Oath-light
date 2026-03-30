/* ═══════════════════════════════════════════════════════════════════
   Pure Path — Mentor Chat Page
   "White Space" AI mentor — clean chat UI with suggestion chips
   ═══════════════════════════════════════════════════════════════════ */

window.PurePathPages = window.PurePathPages || {};

window.PurePathPages.mentor = (function () {
  'use strict';

  const T = window.PurePathTransitions;

  /* ─── Suggestion Chips ─────────────────────────────────────────── */
  const suggestions = [
    'How do I stay motivated?',
    'What are healthy coping strategies?',
    'How to build better habits?',
    'I\'m feeling tempted right now',
    'Tips for digital wellbeing',
    'How to handle urges?',
  ];

  /* ─── Mock AI Responses ────────────────────────────────────────── */
  const responses = {
    'how do i stay motivated': `That's a great question! Motivation is like a muscle — it grows stronger with consistent use. Here are some strategies:\n\n• Set clear, specific daily goals rather than vague ones\n• Celebrate small wins — every blocked attempt is a victory\n• Remind yourself WHY you started this journey\n• Keep a journal of your progress and feelings\n• Connect with others who share your goals\n\nRemember, you don't need to feel motivated to take action. Often, action creates motivation, not the other way around.`,

    'what are healthy coping strategies': `I'm glad you're looking for healthy alternatives. Here are proven coping strategies:\n\n• Physical exercise — even a short walk releases endorphins\n• Deep breathing: inhale for 4 counts, hold for 4, exhale for 8\n• Call or message a friend or family member\n• Creative outlets: drawing, writing, music\n• Mindfulness meditation — even 5 minutes helps\n• Cold water on your face activates the dive reflex and calms you\n\nThe key is having these strategies ready BEFORE you need them. Which ones resonate with you?`,

    'how to build better habits': `Building better habits is all about systems, not willpower. Here's the science-backed approach:\n\n1. **Start incredibly small** — 2 minutes or less\n2. **Stack habits** — attach new habits to existing ones\n3. **Design your environment** — make good things easy, bad things hard\n4. **Track your progress** — don't break the chain\n5. **Be patient** — habits take 21-66 days to form\n\nYou're already using Pure Path, which means you've taken the most important step: designing your environment for success. That takes real wisdom.`,

    'i\'m feeling tempted right now': `I hear you, and I want you to know: this feeling is temporary. It will pass.\n\nRight now, try this:\n\n🧊 **The 10-minute rule** — Tell yourself you'll wait just 10 minutes. Urges peak and fade in waves.\n\n🚶 **Move your body** — Stand up, stretch, or walk to another room. Physical change creates mental change.\n\n🧠 **Name it** — Say to yourself: "I'm experiencing an urge. It's just a feeling, not a command."\n\n💪 **Remember your streak** — You've been protected for days. Every moment you resist makes you stronger.\n\nYou reached out instead of giving in. That alone shows incredible strength.`,

    'tips for digital wellbeing': `Digital wellbeing is about creating a healthy relationship with technology. Here are my top tips:\n\n📱 **Set screen time limits** — Use built-in tools on your devices\n🌅 **No screens 1 hour before bed** — Blue light disrupts sleep\n🔕 **Notification diet** — Turn off non-essential notifications\n📚 **Replace, don't remove** — Replace scrolling with reading or podcasts\n🎯 **Intentional usage** — Before picking up your phone, ask: "What am I here to do?"\n🌿 **Touch grass daily** — Spend time outdoors without devices\n\nPure Path is already a big step toward intentional digital living. You should feel proud!`,

    'how to handle urges': `Urges are like waves — they rise, peak, and fall. You don't need to act on them. Here's your toolkit:\n\n🌊 **Urge surfing** — Observe the urge without acting. Notice where you feel it in your body. It will pass.\n\n⏱️ **Delay & distract** — Set a 15-minute timer and do something engaging (pushups, call someone, play music).\n\n✍️ **Write it out** — Journaling about the urge reduces its power.\n\n📋 **Play the tape forward** — Imagine how you'll feel AFTER giving in vs. after resisting.\n\n🏔️ **Remember your "why"** — What's the bigger picture? Who are you becoming?\n\nEvery urge you ride out makes the next one easier. You're rewiring your brain right now.`,
  };

  const defaultResponse = `Thank you for sharing. That's a thoughtful question.\n\nI'd encourage you to reflect on it, and remember that growth isn't always linear. Every step forward, no matter how small, counts.\n\nHere are some things to consider:\n• What does your ideal day look like?\n• What small change could you make today?\n• Who in your life can you lean on for support?\n\nI'm here whenever you need to talk. You're doing great by simply being here and seeking guidance.`;

  function getResponse(input) {
    const lower = input.toLowerCase().trim();
    for (const [key, val] of Object.entries(responses)) {
      if (lower.includes(key) || key.includes(lower)) {
        return val;
      }
    }
    // Fuzzy match: check if any key words are in the input
    for (const [key, val] of Object.entries(responses)) {
      const keyWords = key.split(' ').filter(w => w.length > 3);
      const matchCount = keyWords.filter(w => lower.includes(w)).length;
      if (matchCount >= 2) return val;
    }
    return defaultResponse;
  }

  function formatTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatMessage(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  /* ─── State ────────────────────────────────────────────────────── */
  let messages = [];
  let showSuggestions = true;

  /* ─── Render ───────────────────────────────────────────────────── */
  function render() {
    return `
      <div class="mentor-container">
        <div class="mentor-header">
          <h1 class="page-title">Mentor</h1>
          <p class="page-subtitle">Your personal guide on the path to clarity.</p>
        </div>

        <div class="chat-area" id="chat-area">
          <div class="chat-messages" id="chat-messages">
            <div class="chat-welcome" id="chat-welcome">
              <div class="chat-welcome-icon">✨</div>
              <h3 class="chat-welcome-title">Welcome to your Sanctuary</h3>
              <p class="chat-welcome-subtitle">I'm here to support you on your journey. Ask me anything about motivation, habits, or digital wellbeing.</p>
            </div>
          </div>

          <div class="suggestion-chips" id="suggestion-chips">
            ${suggestions.map(s => `<button class="suggestion-chip" data-suggestion="${s}">${s}</button>`).join('')}
          </div>

          <div class="chat-input-bar">
            <input type="text" class="chat-input" id="chat-input" placeholder="Ask your mentor anything..." autocomplete="off">
            <button class="chat-send-btn" id="chat-send-btn" title="Send">
              <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /* ─── Chat Logic ───────────────────────────────────────────────── */
  function addMessage(role, text) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    // Hide welcome on first message
    const welcome = document.getElementById('chat-welcome');
    if (welcome) {
      gsap.to(welcome, { opacity: 0, scale: 0.95, duration: 0.3, onComplete: () => welcome.remove() });
    }

    // Hide suggestions after first user message
    if (role === 'user' && showSuggestions) {
      showSuggestions = false;
      const chips = document.getElementById('suggestion-chips');
      if (chips) {
        gsap.to(chips, { opacity: 0, y: 10, duration: 0.3, onComplete: () => { chips.style.display = 'none'; } });
      }
    }

    const time = formatTime();
    const avatar = role === 'user' ? '👤' : '✨';
    const formattedText = formatMessage(text);

    const row = document.createElement('div');
    row.className = `message-row ${role}`;
    row.innerHTML = `
      <div class="message-avatar">${avatar}</div>
      <div>
        <div class="message-bubble">${formattedText}</div>
        <div class="message-time">${time}</div>
      </div>
    `;

    container.appendChild(row);

    // Animate in
    gsap.fromTo(row,
      { opacity: 0, y: 14, scale: 0.97 },
      { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'power3.out' }
    );

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;

    messages.push({ role, text, time });
  }

  function showTypingIndicator() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.id = 'typing-indicator';
    indicator.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;

    gsap.fromTo(indicator,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.3 }
    );
  }

  function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
  }

  function sendMessage(text) {
    if (!text.trim()) return;
    addMessage('user', text);

    // Show typing indicator
    showTypingIndicator();

    // Simulate AI response delay
    const delay = 800 + Math.random() * 1200;
    setTimeout(() => {
      hideTypingIndicator();
      const response = getResponse(text);
      addMessage('ai', response);
    }, delay);
  }

  /* ─── Init ─────────────────────────────────────────────────────── */
  function init() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');

    if (sendBtn) {
      sendBtn.addEventListener('click', () => {
        sendMessage(input.value);
        input.value = '';
      });
    }

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(input.value);
          input.value = '';
        }
      });
    }

    // Suggestion chips
    document.querySelectorAll('.suggestion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const suggestion = chip.getAttribute('data-suggestion');
        sendMessage(suggestion);
      });
    });

    // Animate entrance
    T.slideUp(document.querySelector('.mentor-header'), 0);
    T.slideUp(document.getElementById('chat-area'), 0.1);
  }

  function destroy() {
    messages = [];
    showSuggestions = true;
  }

  return { render, init, destroy };
})();
