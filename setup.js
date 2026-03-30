// Setup page script

// Generate a random salt
function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// Hash password with PBKDF2 + salt for proper security
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

const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirmPassword');
const goalInput = document.getElementById('goal');
const consentCheckbox = document.getElementById('consent');
const setupBtn = document.getElementById('setupBtn');
const errorMessage = document.getElementById('errorMessage');

// Enable button when consent is checked
consentCheckbox.addEventListener('change', () => {
  setupBtn.disabled = !consentCheckbox.checked;
});

setupBtn.addEventListener('click', async () => {
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;
  const goal = goalInput.value;
  
  // Validation
  if (!password || !confirmPassword) {
    errorMessage.textContent = 'Please enter and confirm your password';
    return;
  }
  
  if (password.length < 6) {
    errorMessage.textContent = 'Password must be at least 6 characters';
    return;
  }
  
  if (password !== confirmPassword) {
    errorMessage.textContent = 'Passwords do not match';
    return;
  }
  
  // Generate salt and hash password with PBKDF2
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);
  
  // Save to storage (salt stored alongside hash)
  chrome.storage.local.set({
    passwordHash: hash,
    passwordSalt: salt,
    userGoal: goal,
    setupComplete: true,
    stats: {
      totalBlocks: 0,
      installDate: new Date().toISOString()
    }
  }, () => {
    if (chrome.runtime.lastError) {
      errorMessage.textContent = 'Error saving settings. Please try again.';
      console.error('Setup error:', chrome.runtime.lastError);
      return;
    }
    
    // Close setup and open popup
    window.close();
  });
});
