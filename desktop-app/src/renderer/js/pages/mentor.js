/* ═══════════════════════════════════════════════════════════════════
   Pure Path — Mentor Chat Page
   "White Space" AI mentor — clean chat UI with suggestion chips
   ═══════════════════════════════════════════════════════════════════ */

window.PurePathPages = window.PurePathPages || {};

window.PurePathPages.mentor = (function () {
  'use strict';

  const T = window.PurePathTransitions;

  /* ─── IMPORTANT FOR DEVELOPERS ───────────────────────────────────
   * Add new tips and Q&As to this array. They will automatically
   * populate the right-hand Knowledge Base column on the Mentor page.
   * Format: { q: 'Question/Tip Title', a: 'Detailed answer or text.' }
   * ────────────────────────────────────────────────────────────── */
  const TipsAndQuestions = [
    {
      q: 'How do I stay motivated?',
      a: 'Motivation is like a muscle — it grows stronger with consistent use. Set clear daily goals, celebrate small wins, and remind yourself WHY you started this journey.'
    },
    {
      q: 'What are healthy coping strategies?',
      a: 'Physical exercise, deep breathing, calling a friend, or creative outlets like drawing. The key is having these strategies ready BEFORE you need them.'
    },
    {
      q: 'How to build better habits?',
      a: 'Start incredibly small (2 minutes), stack new habits onto existing ones, design your environment so bad habits are hard, and track your progress patiently.'
    },
    {
      q: 'I\'m feeling tempted right now',
      a: 'Use the 10-minute rule: tell yourself you will wait just 10 minutes. Move your body to a different room. Nam the feeling: "I am experiencing an urge. It is just a feeling, not a command."'
    },
    {
      q: 'Tips for digital wellbeing',
      a: 'Set screen time limits, implement "no screens 1 hour before bed", turn off non-essential notifications, and replace scrolling with reading. Touch grass daily.'
    },
    {
      q: 'How to handle urges?',
      a: '"Urge Surfing" — observe the urge without acting. Notice where you feel it in your body. It will pass. Play the tape forward and remember why you started.'
    }
  ];

  /* ─── Render ───────────────────────────────────────────────────── */
  function render() {
    return `
      <div class="mentor-container flex-col" style="height: 100%;">
        <div class="mentor-header mb-24">
          <h1 class="page-title">Mentor</h1>
          <p class="page-subtitle">Your personal guide on the path to clarity.</p>
        </div>

        <div class="mentor-split" id="mentor-split">
          
          <!-- Left Panel: Chatbot (Coming Soon) -->
          <div class="glass-card-static mentor-panel" style="padding: 0;">
            <div class="mentor-panel-header">
              <span class="panel-icon" style="width: 32px; height: 32px; font-size: 16px;">✨</span>
              <span class="mentor-panel-title">AI Sanctuary Guide</span>
            </div>
            
            <div class="chat-area" id="chat-area" style="flex: 1; padding: 24px;">
              <div class="chat-messages" id="chat-messages" style="height: 100%;">
                <div class="chat-welcome" id="chat-welcome">
                  <div class="chat-welcome-icon">✨</div>
                  <h3 class="chat-welcome-title">Welcome to your Sanctuary</h3>
                  <p class="chat-welcome-subtitle">I'm here to support you on your journey. Ask me anything about motivation, habits, or digital wellbeing.</p>
                </div>
              </div>

              <!-- Blurred out input -->
              <div class="chat-input-bar chat-input-bar-blurred" style="position: absolute; bottom: 24px; left: 24px; width: calc(100% - 48px);">
                <input type="text" class="chat-input" disabled placeholder="Ask your mentor anything...">
                <button class="chat-send-btn disabled">
                  <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
            </div>

            <!-- Overlaid Coming Soon Badge -->
            <div class="mentor-overlay">
              <div class="coming-soon-badge">Coming Soon</div>
              <div class="coming-soon-sub">Personalized AI guidance is in development.</div>
            </div>
          </div>

          <!-- Right Panel: Knowledge Base / Tips -->
          <div class="glass-card-static mentor-panel" style="padding: 0;">
             <div class="mentor-panel-header">
              <span class="panel-icon" style="width: 32px; height: 32px; font-size: 16px;">📚</span>
              <span class="mentor-panel-title">Guidance & Tips</span>
            </div>
            <div class="mentor-kb-scroll">
              ${TipsAndQuestions.map(item => `
                <div class="mentor-kb-card">
                  <div class="mentor-kb-q">${item.q}</div>
                  <div class="mentor-kb-a">${item.a}</div>
                </div>
              `).join('')}
            </div>
          </div>

        </div>
      </div>
    `;
  }

  /* ─── Init ─────────────────────────────────────────────────────── */
  function init() {
    // Animate entrance
    T.slideUp(document.querySelector('.mentor-header'), 0);
    
    // Stagger the two panels
    const panels = document.querySelectorAll('.mentor-panel');
    T.staggerCards(panels, 0.1);

    // Stagger KB cards
    const kbCards = document.querySelectorAll('.mentor-kb-card');
    T.staggerCards(kbCards, 0.3);
  }

  function destroy() {
    // Cleanup if needed
  }

  return { render, init, destroy };
})();
