// Blocked page script
const quotes = [
  "The only person you are destined to become is the person you decide to be. - Ralph Waldo Emerson",
  "Success is the sum of small efforts repeated day in and day out. - Robert Collier",
  "You are not your urges. You are the one who decides. - Anonymous",
  "Every moment is a fresh beginning. - T.S. Eliot",
  "The best time to plant a tree was 20 years ago. The second best time is now. - Chinese Proverb",
  "Your future self will thank you for the choices you make today. - Anonymous",
  "Discipline is choosing between what you want now and what you want most. - Abraham Lincoln",
  "The pain of discipline is far less than the pain of regret. - Anonymous"
];

// Get URL parameters (original URL is no longer passed for privacy)
const urlParams = new URLSearchParams(window.location.search);
const reason = urlParams.get('reason');
const match = urlParams.get('match');

// Display reason
const reasonEl = document.getElementById('reason');
if (reason === 'domain') {
  reasonEl.textContent = `Domain blocked: ${match}`;
} else if (reason === 'keyword_domain') {
  reasonEl.textContent = `Domain contains blocked keyword: ${match}`;
} else if (reason === 'keyword_path') {
  reasonEl.textContent = `URL contains explicit content pattern`;
} else if (reason === 'keyword_context') {
  reasonEl.textContent = `URL contains multiple NSFW indicators`;
} else if (reason === 'search_query') {
  reasonEl.textContent = `Search blocked: "${match}" in query`;
} else if (reason === 'search_images') {
  reasonEl.textContent = `Image search blocked: "${match}"`;
} else if (reason === 'keyword_content') {
  reasonEl.textContent = `Page content blocked: ${match}`;
} else if (reason === 'blacklist_domain') {
  reasonEl.textContent = `Blocked domain: ${match}`;
} else if (reason === 'explicit_domain') {
  reasonEl.textContent = `Explicit domain blocked`;
} else if (reason === 'graylist_explicit') {
  reasonEl.textContent = `NSFW content blocked on monitored site`;
} else if (reason === 'safesearch_bypass') {
  reasonEl.textContent = `SafeSearch was disabled — bypass attempt blocked`;
} else {
  reasonEl.textContent = 'This page was blocked to help you stay focused.';
}

// Display random quote
const quoteEl = document.getElementById('quote');
quoteEl.textContent = quotes[Math.floor(Math.random() * quotes.length)];

// Load and display stats
chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
  if (chrome.runtime.lastError) {
    console.error('Error loading stats:', chrome.runtime.lastError);
    return;
  }
  
  if (response && response.stats) {
    const stats = response.stats;
    
    // Total blocks
    document.getElementById('totalBlocks').textContent = stats.totalBlocks || 0;
    
    // Days since install
    if (stats.installDate) {
      const installDate = new Date(stats.installDate);
      const now = new Date();
      const daysDiff = Math.floor((now - installDate) / (1000 * 60 * 60 * 24));
      document.getElementById('daysClean').textContent = daysDiff;
    }
  }
});

// Handle "Go to Safe Page" button
document.getElementById('goBackBtn').addEventListener('click', () => {
  try {
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id) {
        chrome.tabs.update(tab.id, { url: 'https://www.google.com' });
      } else {
        window.location.href = 'https://www.google.com';
      }
    });
  } catch (error) {
    window.location.href = 'https://www.google.com';
  }
});

// Load saved theme
if(typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get(['theme'], (result) => {
    if(result.theme) {
      document.documentElement.setAttribute('data-theme', result.theme);
    }
  });
}

// Fluid Animation Setup using GSAP
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('fluidCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  let width, height;
  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const waves = [
    { color: 'rgba(56, 189, 248, 0.4)', phase: 0, amp: 120, yOffset: 0.55 }, // Cyan-ish blue
    { color: 'rgba(129, 140, 248, 0.5)', phase: 2, amp: 90, yOffset: 0.65 }, // Purple/Indigo
    { color: 'rgba(59, 130, 246, 0.6)', phase: 4, amp: 100, yOffset: 0.75 }, // Blue
    { color: '#ffffff', phase: 1, amp: 40, yOffset: 0.95 } // White floor
  ];

  // Soft glowing orbs for the top empty space
  const orbs = [
    { x: 0.15, y: 0.2, baseRadius: 0.25, color: 'rgba(129, 140, 248, 0.15)', angle: 0 },
    { x: 0.85, y: 0.25, baseRadius: 0.3, color: 'rgba(56, 189, 248, 0.12)', angle: 2 },
    { x: 0.5, y: 0.1, baseRadius: 0.35, color: 'rgba(192, 132, 252, 0.08)', angle: 4 }
  ];

  orbs.forEach(orb => {
    gsap.to(orb, {
      angle: orb.angle + Math.PI * 2,
      duration: 15 + Math.random() * 10,
      repeat: -1,
      ease: "none"
    });
  });

  // Slower, calming fluid waves
  waves.forEach(wave => {
    gsap.to(wave, {
      phase: wave.phase + Math.PI * 2,
      duration: 20 + Math.random() * 12, // Much slower for a calmer feel
      repeat: -1,
      ease: "none"
    });
  });

  // Tiny floating particles (glow effect)
  const particles = Array.from({ length: 25 }, () => ({
    x: Math.random(),
    y: Math.random(),
    speed: 0.0002 + Math.random() * 0.0008, // Slower bubble rise
    swaySpeed: 5 + Math.random() * 10, // Slower sway
    swayAmp: 0.0003 + Math.random() * 0.0008,
    radius: 1.5 + Math.random() * 4,
    color: `rgba(255, 255, 255, ${0.1 + Math.random() * 0.3})`
  }));

  gsap.ticker.add(() => {
    ctx.clearRect(0, 0, width, height);

    // Draw floating orbs (Top space)
    orbs.forEach(orb => {
      const x = (orb.x * width) + Math.cos(orb.angle) * 60;
      const y = (orb.y * height) + Math.sin(orb.angle * 1.5) * 40;
      const radius = orb.baseRadius * Math.min(width, height);
      
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, orb.color);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    });

    // Draw rising particles with subtle glow
    particles.forEach(p => {
      p.y -= p.speed;
      p.x += Math.sin(p.y * p.swaySpeed) * p.swayAmp;
      
      if (p.y < -0.05) {
        p.y = 1.05;
        p.x = Math.random();
      }
      
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });
    
    // Draw fluid waves (Bottom space) with realistic shadows
    waves.forEach((wave, index) => {
      ctx.beginPath();
      ctx.moveTo(0, height);
      
      for (let x = 0; x <= width + 15; x += 15) {
        // Smoothened out wave amplitude slightly for calmer water
        const y = height * wave.yOffset + 
                  Math.sin(x * 0.0015 + wave.phase) * wave.amp + 
                  Math.sin(x * 0.003 - wave.phase * 0.8) * (wave.amp * 0.3);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      
      ctx.fillStyle = wave.color;
      ctx.fill();
    });
  });
});
