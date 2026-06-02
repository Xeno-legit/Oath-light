// BLOCKLISTS MANAGER SCRIPT — Domain-only

let domains = [];
let defaultDomainsSet = new Set(); // To track built-in domains
let stats = { totalBlocks: 0 };
let isDataLoaded = false; // Track if data is loaded

// Debug mode flag
const DEBUG = false;

function debugLog(category, message, data = null) {
  if (!DEBUG) return;

  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[${timestamp}] [${category}]`;

  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// CACHE MANAGEMENT - Persist counts across page refreshes

function saveCounts() {
  try {
    localStorage.setItem('purepath_domain_count', domains.length);
    localStorage.setItem('purepath_threats_count', stats.totalBlocks || 0);
    debugLog('CACHE', 'Saved counts to localStorage');
  } catch (error) {
    debugLog('CACHE', 'Failed to save counts:', error);
  }
}

function loadCachedCounts() {
  try {
    const cachedDomainCount = localStorage.getItem('purepath_domain_count');
    const cachedThreatsCount = localStorage.getItem('purepath_threats_count');

    if (cachedDomainCount) {
      document.getElementById('domainCount').textContent = parseInt(cachedDomainCount).toLocaleString();
      document.getElementById('domainStatus').textContent = `● ${parseInt(cachedDomainCount).toLocaleString()} ACTIVE`;
    }

    if (cachedThreatsCount) {
      const threatsCount = parseInt(cachedThreatsCount);
      let formatted;
      if (threatsCount >= 1000000) {
        formatted = (threatsCount / 1000000).toFixed(1) + 'M';
      } else if (threatsCount >= 1000) {
        formatted = (threatsCount / 1000).toFixed(1) + 'k';
      } else {
        formatted = threatsCount.toString();
      }
      document.getElementById('threatsCount').textContent = formatted;
    }

    debugLog('CACHE', 'Loaded cached counts from localStorage');
  } catch (error) {
    debugLog('CACHE', 'Failed to load cached counts:', error);
  }
}

// Load cached counts immediately on page load
loadCachedCounts();

debugLog('INIT', 'Blocklist Manager initializing...');

// Load blocklists from JSON files directly (3 parts in parallel)
async function loadBlocklistsFromFiles() {
  try {
    debugLog('LOAD', 'Loading blocklists from JSON part files...');
    const [r1, r2, r3] = await Promise.all([
      fetch('blocklists/domains_part1.json'),
      fetch('blocklists/domains_part2.json'),
      fetch('blocklists/domains_part3.json'),
    ]);
    const [d1, d2, d3] = await Promise.all([r1.json(), r2.json(), r3.json()]);

    const fileDomains = [
      ...(d1.domains || []),
      ...(d2.domains || []),
      ...(d3.domains || []),
    ];
    defaultDomainsSet = new Set(fileDomains);
    
    // Only overwrite if we don't have background domains yet
    if (domains.length === 0 || domains.length === fileDomains.length) {
      domains = fileDomains;
    }
    isDataLoaded = true;

    debugLog('LOAD', `Loaded ${domains.length} domains from part files`);

    // Update counts and save to cache
    updateCounts();
    saveCounts();
    debugLog('UI', 'UI updated with counts from files');

    return true;
  } catch (error) {
    debugLog('ERROR', 'Failed to load from files:', error);
    return false;
  }
}

loadBlocklistsFromFiles().then(success => {
  if (success) {
    debugLog('INIT', ' Initialization complete from files');
  } else {
    debugLog('ERROR', 'Failed to initialize from files');
    showSystemError('Failed to load blocklists. Please reload the page.');
  }
});

chrome.runtime.sendMessage({ action: 'getBlocklists' }, (response) => {
  if (chrome.runtime.lastError) {
    debugLog('WARN', '️ Background script not available:', chrome.runtime.lastError);
    return;
  }

  if (response && response.domains) {
    // Only update if we got valid data from background
    if (response.domains.length > 0) {
      domains = response.domains;
      isDataLoaded = true;

      debugLog('LOAD', `Updated from background: ${domains.length} domains`);

      // Update counts and save to cache only if default domains are loaded
      if (defaultDomainsSet.size > 0) {
        updateCounts();
        saveCounts();
        debugLog('UI', 'UI updated with counts from background');
      } else {
        debugLog('UI', '⏳ Waiting for default domains to load before rendering');
      }
    } else {
      debugLog('WARN', '️ Background returned empty arrays, keeping file data');
    }
  }
});

chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
  if (chrome.runtime.lastError) {
    debugLog('ERROR', 'Failed to load stats:', chrome.runtime.lastError);
    return;
  }

  if (response && response.stats) {
    stats = response.stats;
    debugLog('STATS', 'Stats loaded:', stats);
    updateThreatsCount();
    saveCounts();
  } else {
    debugLog('WARN', '️ No stats available');
  }
});

function showSystemError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
    border: 2px solid #fca5a5;
    border-radius: 12px;
    padding: 16px 20px;
    color: #991b1b;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  errorDiv.textContent = `⚠️ ${message}`;
  document.body.appendChild(errorDiv);

  setTimeout(() => {
    errorDiv.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => errorDiv.remove(), 300);
  }, 5000);
}

function updateCounts() {
  // Domain counts
  document.getElementById('domainCount').textContent = domains.length.toLocaleString();
  document.getElementById('domainStatus').textContent = `● ${domains.length.toLocaleString()} ACTIVE`;
  document.getElementById('domainSearch').placeholder = `Search ${domains.length.toLocaleString()} domains...`;

  renderUserDomains();

  // Save to cache
  saveCounts();
}

function renderUserDomains() {
  const container = document.getElementById('userDomainsList');
  if (!container) return;

  // Filter out default domains to find user-added ones
  const userDomains = domains.filter(d => !defaultDomainsSet.has(d));

  if (userDomains.length === 0) {
    container.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 14px; background: rgba(0,0,0,0.02); border-radius: 12px;">You haven't added any custom domains yet.</div>`;
    return;
  }

  // Generate HTML for each user domain
  container.innerHTML = userDomains.map(d => `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: rgba(255,255,255,0.5); border: 1px solid var(--card-border); border-radius: 12px;">
      <span style="font-weight: 500;">${d}</span>
      <button class="delete-user-domain-btn" data-domain="${d}" style="background: rgba(239,68,68,0.1); color: #ef4444; border: none; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;">Remove</button>
    </div>
  `).join('');
}

// Handle delegated clicks for deleting user domains
document.addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('.delete-user-domain-btn');
  if (!deleteBtn) return;
  
  const domainToDelete = deleteBtn.dataset.domain;
  if (confirm(`Are you sure you want to remove ${domainToDelete} from your blocklist?`)) {
    deleteUserDomain(domainToDelete);
  }
});

function deleteUserDomain(domain) {
  // Remove from array
  domains = domains.filter(d => d !== domain);
  
  // Update in storage
  chrome.runtime.sendMessage({ 
    action: 'updateBlocklists', 
    domains: domains 
  }, (response) => {
    if (chrome.runtime.lastError || (response && !response.success)) {
      debugLog('ERROR', 'Failed to delete domain', chrome.runtime.lastError);
      showSystemError('Failed to remove domain. Please try again.');
      // Rollback might be needed here, but for simplicity we rely on reload if failed
      return;
    }
    
    // Success
    debugLog('DOMAIN-DEL', `Successfully removed domain: ${domain}`);
    updateCounts();
  });
}

function updateThreatsCount() {
  const threatsCount = stats.totalBlocks || 0;
  // Format as "142.8k" style
  let formatted;
  if (threatsCount >= 1000000) {
    formatted = (threatsCount / 1000000).toFixed(1) + 'M';
  } else if (threatsCount >= 1000) {
    formatted = (threatsCount / 1000).toFixed(1) + 'k';
  } else {
    formatted = threatsCount.toString();
  }
  document.getElementById('threatsCount').textContent = formatted;

  // Save to cache
  saveCounts();
}

// ENHANCED DOMAIN SEARCH FUNCTIONALITY

const domainSearch = document.getElementById('domainSearch');
const domainResult = document.getElementById('domainResult');

domainSearch.addEventListener('input', (e) => {
  const searchTerm = e.target.value.trim().toLowerCase();

  console.log('Domain Search:', searchTerm);

  if (searchTerm === '') {
    domainResult.classList.add('hidden');
    return;
  }

  // Clean the search term (remove protocol, www, trailing slash)
  let cleanSearch = searchTerm
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');

  console.log('Cleaned search:', cleanSearch);
  console.log('  Total domains:', domains.length);

  // Find all matching domains
  const matches = domains.filter(domain => {
    const lowerDomain = domain.toLowerCase();
    // Check for exact match or partial match
    return lowerDomain === cleanSearch ||
      lowerDomain.includes(cleanSearch) ||
      cleanSearch.includes(lowerDomain);
  });

  console.log('  Matches found:', matches.length);
  if (matches.length > 0) {
    console.log('  Matched domains:', matches.slice(0, 5));
  }

  domainResult.classList.remove('hidden');

  if (matches.length > 0) {
    // Show exact match if exists
    const exactMatch = matches.find(d => d.toLowerCase() === cleanSearch);

    domainResult.className = 'search-result found';

    if (exactMatch) {
      domainResult.innerHTML = `
        <div style="display: flex; align-items: center;">
          <span class="result-icon">✅</span>
          <div style="flex: 1;">
            <div class="result-text">Exact match found</div>
            <div class="result-detail"><strong>${exactMatch}</strong> is blocked</div>
            ${matches.length > 1 ? `<div class="result-detail" style="margin-top: 4px;">+${matches.length - 1} similar domain(s)</div>` : ''}
          </div>
        </div>
      `;
    } else {
      // Show partial matches
      const displayMatches = matches.slice(0, 3);
      const remaining = matches.length - displayMatches.length;

      domainResult.innerHTML = `
        <div style="display: flex; align-items: flex-start;">
          <span class="result-icon">✅</span>
          <div style="flex: 1;">
            <div class="result-text">${matches.length} matching domain${matches.length > 1 ? 's' : ''} found</div>
            <div class="result-detail" style="margin-top: 8px;">
              ${displayMatches.map(d => `<div style="margin: 2px 0; font-family: monospace; font-size: 12px;">• ${highlightMatch(d, cleanSearch)}</div>`).join('')}
              ${remaining > 0 ? `<div style="margin-top: 4px; font-style: italic;">+${remaining} more...</div>` : ''}
            </div>
          </div>
        </div>
      `;
    }
  } else {
    domainResult.className = 'search-result not-found';
    domainResult.innerHTML = `
      <div style="display: flex; align-items: center;">
        <span class="result-icon">❌</span>
        <div style="flex: 1;">
          <div class="result-text">No matches found</div>
          <div class="result-detail"><strong>${cleanSearch.replace(/[<>"'&]/g, '')}</strong> is not in the blocklist</div>
          <div class="result-detail" style="margin-top: 4px; font-size: 12px;">
            <button class="add-from-search-btn" data-type="domain" data-value="${cleanSearch.replace(/["'\\]/g, '')}"
                    style="background: #4dabf7; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-top: 4px;">
              + Add to blocklist
            </button>
          </div>
        </div>
      </div>
    `;
  }
});

// Helper function to highlight matching text
function highlightMatch(text, search) {
  const index = text.toLowerCase().indexOf(search.toLowerCase());
  if (index === -1) return text;

  const before = text.substring(0, index);
  const match = text.substring(index, index + search.length);
  const after = text.substring(index + search.length);

  return `${before}<span style="background: #fef08a; padding: 0 2px; border-radius: 2px; font-weight: 600;">${match}</span>${after}`;
}

// ADD DOMAIN FUNCTIONALITY

const addDomainBtn = document.getElementById('addDomainBtn');
const addDomainModal = document.getElementById('addDomainModal');
const closeDomainModal = document.getElementById('closeDomainModal');
const cancelDomainBtn = document.getElementById('cancelDomainBtn');
const saveDomainBtn = document.getElementById('saveDomainBtn');
const domainInput = document.getElementById('domainInput');
const domainModalMessage = document.getElementById('domainModalMessage');

addDomainBtn.addEventListener('click', () => {
  addDomainModal.classList.remove('hidden');
  domainInput.value = '';
  domainModalMessage.innerHTML = '';
  domainInput.focus();
});

function closeDomainModalFunc() {
  // Add closing animation
  addDomainModal.classList.add('closing');

  // Wait for animation to complete before hiding
  setTimeout(() => {
    addDomainModal.classList.add('hidden');
    addDomainModal.classList.remove('closing');
    domainInput.value = '';
    domainModalMessage.innerHTML = '';
  }, 200);
}

closeDomainModal.addEventListener('click', closeDomainModalFunc);
cancelDomainBtn.addEventListener('click', closeDomainModalFunc);

// Close modal on overlay click (but not when clicking inside the modal)
addDomainModal.addEventListener('click', (e) => {
  if (e.target === addDomainModal) {
    closeDomainModalFunc();
  }
});

// Prevent modal content clicks from closing the modal
document.querySelector('#addDomainModal .modal').addEventListener('click', (e) => {
  e.stopPropagation();
});

saveDomainBtn.addEventListener('click', () => {
  const domain = domainInput.value.trim().toLowerCase();

  debugLog('DOMAIN-ADD', 'Attempting to add domain:', domain);

  // Validate domain
  if (!domain) {
    debugLog('DOMAIN-ADD', 'Validation failed: Empty domain');
    showDomainMessage('️ Please enter a domain', 'error');
    domainInput.focus();
    return;
  }

  // Remove protocol and www
  let cleanDomain = domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');

  debugLog('DOMAIN-ADD', 'Cleaned domain:', cleanDomain);

  // Basic domain validation
  if (!cleanDomain.includes('.') || cleanDomain.includes(' ')) {
    debugLog('DOMAIN-ADD', 'Validation failed: Invalid format');
    showDomainMessage('️ Please enter a valid domain (e.g., example.com)', 'error');
    domainInput.focus();
    return;
  }

  // Check if already exists
  if (domains.includes(cleanDomain)) {
    debugLog('DOMAIN-ADD', ' Domain already exists in blocklist');
    showDomainMessage('️ This domain is already in the blocklist', 'error');
    domainInput.focus();
    return;
  }

  // Disable button while saving
  saveDomainBtn.disabled = true;
  saveDomainBtn.textContent = 'Adding...';

  debugLog('DOMAIN-ADD', 'Saving to storage...');

  // Add to domains array
  domains.push(cleanDomain);
  domains.sort();

  debugLog('DOMAIN-ADD', `New total: ${domains.length} domains`);

  // Update in storage
  chrome.runtime.sendMessage({
    action: 'updateBlocklists',
    domains: domains
  }, (response) => {
    saveDomainBtn.disabled = false;
    saveDomainBtn.textContent = 'Add Domain';

    if (chrome.runtime.lastError) {
      debugLog('DOMAIN-ADD', 'Chrome runtime error:', chrome.runtime.lastError);
      showDomainMessage('Failed to add domain. Please try again.', 'error');
      // Rollback
      domains = domains.filter(d => d !== cleanDomain);
      return;
    }

    if (response && response.success) {
      debugLog('DOMAIN-ADD', 'Successfully added domain');
      showDomainMessage(`Successfully added "${cleanDomain}" to blocklist`, 'success');
      updateCounts();
      domainInput.value = '';

      // Close modal after 1.5 seconds
      setTimeout(() => {
        closeDomainModalFunc();
      }, 1500);
    } else {
      debugLog('DOMAIN-ADD', 'Save failed:', response);
      showDomainMessage('Failed to add domain. Please try again.', 'error');
      // Rollback
      domains = domains.filter(d => d !== cleanDomain);
    }
  });
});

function showDomainMessage(message, type) {
  const className = type === 'success' ? 'success-message' : 'error-message';
  domainModalMessage.innerHTML = `<div class="${className}">${message}</div>`;
}

domainInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveDomainBtn.click();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!addDomainModal.classList.contains('hidden')) {
      closeDomainModalFunc();
    }
  }
});

// DELEGATED CLICK HANDLER — replaces inline onclick (XSS-safe)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.add-from-search-btn');
  if (!btn) return;

  const type = btn.dataset.type;
  const value = btn.dataset.value;

  if (type === 'domain') {
    document.getElementById('addDomainBtn').click();
    document.getElementById('domainInput').value = value;
  }
});

if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get(['theme'], (result) => {
    if (result.theme) {
      document.documentElement.setAttribute('data-theme', result.theme);
    }
  });
}
