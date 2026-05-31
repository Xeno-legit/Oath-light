
// Hash password with PBKDF2 + salt
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashArray = Array.from(new Uint8Array(derivedBits));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const quotes = [
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "Your time is limited, so don't waste it living someone else's life.", author: "Steve Jobs" },
  { text: "The only person you are destined to become is the person you decide to be.", author: "Ralph Waldo Emerson" },
  { text: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier" },
  { text: "You are not your urges. You are the one who decides.", author: "Anonymous" }
];

function displayRandomQuote() {
  const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
  document.getElementById('quoteText').textContent = `"${randomQuote.text}"`;
  document.getElementById('quoteAuthor').textContent = randomQuote.author;
}

chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
  if (chrome.runtime.lastError) {
    console.error('Error loading stats:', chrome.runtime.lastError);
    return;
  }
  
  if (response && response.stats) {
    const stats = response.stats;
    document.getElementById('totalBlocks').textContent = stats.totalBlocks || 0;
    
    if (stats.installDate) {
      const installDate = new Date(stats.installDate);
      const now = new Date();
      const daysDiff = Math.floor((now - installDate) / (1000 * 60 * 60 * 24));
      document.getElementById('daysProtected').textContent = daysDiff;
    }
  }
});
document.getElementById('gotoAppBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'launchDesktopApp' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      // If native messaging isn't available, try opening a local app protocol
      // or show a subtle feedback
      const btn = document.getElementById('gotoAppBtn');
      const originalText = btn.innerHTML;
      btn.innerHTML = `<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:white;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> App Not Found`;
      btn.style.background = 'linear-gradient(135deg, #64748b 0%, #475569 100%)';
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.background = '';
      }, 2000);
    }
  });
});

let allDomains = [];
let defaultDomains = [];

function initQuickBlock() {
  const input = document.getElementById('quickBlockUrlInput');
  const actionBtn = document.getElementById('quickBlockActionBtn');
  const messageEl = document.getElementById('quickBlockMessage');

  // Load domains
  chrome.runtime.sendMessage({ action: 'getBlocklists' }, async (bgResponse) => {
    allDomains = (bgResponse && bgResponse.domains) ? bgResponse.domains : [];
    
    try {
      const defaultRes = await fetch(chrome.runtime.getURL('blocklists/domains.json'));
      const defaultData = await defaultRes.json();
      defaultDomains = defaultData.domains || [];
    } catch (e) {
      console.error("Failed to load default domains", e);
    }
  });

  input.addEventListener('input', () => {
    const rawVal = input.value.trim().toLowerCase();
    if (!rawVal) {
      actionBtn.textContent = 'Block';
      actionBtn.className = 'quick-block-btn-small';
      messageEl.textContent = '';
      return;
    }

    const cleanDomain = rawVal.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    
    const isDefault = defaultDomains.includes(cleanDomain);
    const isBlocked = allDomains.includes(cleanDomain);

    if (isDefault) {
      actionBtn.textContent = 'Locked';
      actionBtn.className = 'quick-block-btn-small';
      actionBtn.style.opacity = '0.5';
      actionBtn.style.cursor = 'not-allowed';
      messageEl.textContent = 'This is a default blocked domain.';
      messageEl.style.color = '#ef4444';
    } else if (isBlocked) {
      actionBtn.textContent = 'Remove';
      actionBtn.className = 'quick-block-btn-small remove-mode';
      actionBtn.style.opacity = '1';
      actionBtn.style.cursor = 'pointer';
      messageEl.textContent = 'Domain is in your custom blocklist.';
      messageEl.style.color = '#10b981';
    } else {
      actionBtn.textContent = 'Block';
      actionBtn.className = 'quick-block-btn-small';
      actionBtn.style.opacity = '1';
      actionBtn.style.cursor = 'pointer';
      messageEl.textContent = '';
    }
  });

  actionBtn.addEventListener('click', () => {
    const rawVal = input.value.trim().toLowerCase();
    if (!rawVal) return;
    
    const cleanDomain = rawVal.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    const isDefault = defaultDomains.includes(cleanDomain);
    const isBlocked = allDomains.includes(cleanDomain);

    if (isDefault) return; // Cannot remove default

    actionBtn.style.opacity = '0.5';
    actionBtn.textContent = '...';

    if (!isBlocked) {
      // Add
      allDomains.push(cleanDomain);
    } else {
      // Remove
      allDomains = allDomains.filter(d => d !== cleanDomain);
    }

    chrome.runtime.sendMessage({
      action: 'updateBlocklists',
      domains: allDomains
    }, (response) => {
      if (response && response.success) {
        // Trigger input event to update UI
        input.dispatchEvent(new Event('input'));
        
        // Give feedback
        const msg = !isBlocked ? 'Successfully blocked!' : 'Successfully removed!';
        messageEl.textContent = msg;
        messageEl.style.color = '#10b981';
        setTimeout(() => {
            input.value = '';
            input.dispatchEvent(new Event('input'));
        }, 1500);
      } else {
        messageEl.textContent = 'Error updating blocklist.';
        messageEl.style.color = '#ef4444';
        actionBtn.style.opacity = '1';
        input.dispatchEvent(new Event('input'));
      }
    });
  });
  
  document.getElementById('viewMyBlocklistBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('user_blocklist.html') });
  });
}

initQuickBlock();

displayRandomQuote();
