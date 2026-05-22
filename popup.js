// Pure Path — Popup Script

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
  const q = quotes[Math.floor(Math.random() * quotes.length)];
  document.getElementById('quoteText').textContent = `"${q.text}"`;
  document.getElementById('quoteAuthor').textContent = q.author;
}

// Load stats from extension
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

// Manage Blocklists button
document.getElementById('viewBlocklistsBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'blocklists.html' });
});

// Initialize
displayRandomQuote();
