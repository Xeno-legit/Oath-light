// Popup script

// Hash password with PBKDF2 + salt (matches setup.js)
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

// Quotes array
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

// Display random quote
function displayRandomQuote() {
  const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
  document.getElementById('quoteText').textContent = `"${randomQuote.text}"`;
  document.getElementById('quoteAuthor').textContent = randomQuote.author;
}

// Load stats
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

// View blocklists button
document.getElementById('viewBlocklistsBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'blocklists.html' });
});

// Change password button (placeholder for now)
document.getElementById('changePasswordBtn').addEventListener('click', () => {
  alert('Password change feature coming soon! For now, you can reinstall the extension to set a new password.');
});

// Tab switching logic
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    // Update tabs
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Update views
    const targetView = btn.getAttribute('data-target');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const viewEl = document.getElementById(targetView);
    if (viewEl) viewEl.classList.add('active');
  });
});

// Theme switching logic
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const themeId = btn.getAttribute('data-theme-id');
    document.documentElement.setAttribute('data-theme', themeId);
    
    // Update active class
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Save to chrome.storage
    chrome.storage.local.set({ theme: themeId });
  });
});

// Load saved theme
chrome.storage.local.get(['theme'], (result) => {
  if (result.theme) {
    document.documentElement.setAttribute('data-theme', result.theme);
    document.querySelectorAll('.theme-btn').forEach(b => {
       b.classList.toggle('active', b.getAttribute('data-theme-id') === result.theme);
    });
  }
});

// Initialize
displayRandomQuote();
