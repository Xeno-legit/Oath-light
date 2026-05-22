// Pure Path — Blocked Page Script
// ═══ Mesh Aurora Background + Page Logic ═══

// ─── Reason Display ───
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
      document.getElementById('daysClean').textContent = daysDiff;
    }
  }
});

// Go back button
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


// ═══════════════════════════════════════════════════════════════════
// MESH AURORA — Completely new background animation
// Overlapping gradient spheres with additive blending creating
// an aurora-like effect. Diamond particles echo the logo shape.
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('auroraCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width, height;
  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // ─── Mesh Nodes: large gradient spheres ───
  const meshNodes = [
    {
      x: 0.2, y: 0.3,
      radius: 0.4,
      color: { r: 59, g: 130, b: 246 },  // Blue
      opacity: 0.18,
      phase: 0,
      speedX: 0.0003,
      speedY: 0.0004,
      drift: 80
    },
    {
      x: 0.75, y: 0.25,
      radius: 0.35,
      color: { r: 139, g: 92, b: 246 },  // Purple
      opacity: 0.14,
      phase: 2.1,
      speedX: 0.00025,
      speedY: 0.00035,
      drift: 70
    },
    {
      x: 0.5, y: 0.7,
      radius: 0.45,
      color: { r: 30, g: 58, b: 95 },    // Deep blue
      opacity: 0.22,
      phase: 4.2,
      speedX: 0.0002,
      speedY: 0.0003,
      drift: 90
    },
    {
      x: 0.85, y: 0.65,
      radius: 0.3,
      color: { r: 167, g: 139, b: 250 }, // Light purple
      opacity: 0.10,
      phase: 1.4,
      speedX: 0.00035,
      speedY: 0.00025,
      drift: 60
    },
    {
      x: 0.15, y: 0.8,
      radius: 0.25,
      color: { r: 200, g: 210, b: 230 }, // White mist
      opacity: 0.05,
      phase: 3.5,
      speedX: 0.0003,
      speedY: 0.0002,
      drift: 50
    }
  ];

  // ─── Diamond Particles (logo echo) ───
  const diamonds = Array.from({ length: 12 }, () => ({
    x: Math.random(),
    y: Math.random(),
    size: 3 + Math.random() * 6,
    rotation: Math.random() * Math.PI,
    rotationSpeed: 0.002 + Math.random() * 0.005,
    speed: 0.0001 + Math.random() * 0.0003,
    opacity: 0.03 + Math.random() * 0.06,
    drift: Math.random() * Math.PI * 2
  }));

  // Animate mesh nodes with GSAP
  meshNodes.forEach(node => {
    gsap.to(node, {
      phase: node.phase + Math.PI * 2,
      duration: 30 + Math.random() * 15,
      repeat: -1,
      ease: "none"
    });
  });

  // ─── Render Loop ───
  gsap.ticker.add(() => {
    ctx.clearRect(0, 0, width, height);

    // Enable additive blending for aurora glow
    ctx.globalCompositeOperation = 'lighter';

    // Draw mesh gradient spheres
    meshNodes.forEach(node => {
      const cx = (node.x * width) + Math.sin(node.phase) * node.drift;
      const cy = (node.y * height) + Math.cos(node.phase * 0.7) * node.drift;
      const r = node.radius * Math.min(width, height);

      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const c = node.color;
      gradient.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, ${node.opacity})`);
      gradient.addColorStop(0.5, `rgba(${c.r}, ${c.g}, ${c.b}, ${node.opacity * 0.4})`);
      gradient.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    });

    // Reset composite for diamonds
    ctx.globalCompositeOperation = 'source-over';

    // Draw diamond particles
    diamonds.forEach(d => {
      d.y -= d.speed;
      d.rotation += d.rotationSpeed;
      d.x += Math.sin(d.drift + d.y * 4) * 0.0002;

      // Reset at bottom
      if (d.y < -0.05) {
        d.y = 1.05;
        d.x = Math.random();
      }

      const px = d.x * width;
      const py = d.y * height;

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(d.rotation);
      ctx.beginPath();
      // Diamond shape (rotated square)
      ctx.moveTo(0, -d.size);
      ctx.lineTo(d.size * 0.6, 0);
      ctx.lineTo(0, d.size);
      ctx.lineTo(-d.size * 0.6, 0);
      ctx.closePath();
      ctx.fillStyle = `rgba(167, 139, 250, ${d.opacity})`;
      ctx.fill();
      ctx.restore();
    });
  });
});
