// ===== BLITZ STREAK — game logic =====

// ---- Supabase setup ----
// Guarded: if the CDN script fails to load for any reason, `sb` stays null
// null and login/likes quietly disable instead of crashing the whole game.
const SUPABASE_URL = 'https://kqvisloxkisvvwkqmici.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxdmlzbG94a2lzdnZ3a3FtaWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MzIxODYsImV4cCI6MjEwMDQwODE4Nn0.G6Zut4AiwR61worQNWEJnyavgjkm42A2L6ajtRWeqFI';
const sb = (typeof window.supabase !== 'undefined')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

if (!sb) {
  console.warn('Supabase failed to load — login and likes are disabled, but the game still works.');
}

let currentUser = null;
let authMode = 'login'; // 'login' | 'signup'
const STORAGE_SETTINGS_KEY = 'blitzstreak_settings';
const MISS_DELAY = 1500;    // ms pause after a wrong/timed-out answer
const CORRECT_DELAY = 500;  // ms pause after a correct answer

const TOPIC_LABELS = {
  arithmetic: 'Arithmetic',
  orderOfOps: 'Order of Operations',
  exponents: 'Exponents',
  squareRoots: 'Square Roots',
  equations: 'Solve for X',
};

const NUMTYPE_LABELS = {
  whole: 'Whole',
  integer: 'Integer',
  rational: 'Rational',
};

const DEFAULT_SETTINGS = {
  time: 10,
  lives: 3,
  topics: { arithmetic: true, orderOfOps: true, exponents: true, squareRoots: true, equations: true },
  numberType: 'integer', // 'whole' | 'integer' | 'rational'
};

// ---- settings persistence ----
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (!raw) return structuredCloneSettings(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return {
      time: clamp(Number(parsed.time) || DEFAULT_SETTINGS.time, 5, 20),
      lives: clamp(Number(parsed.lives) || DEFAULT_SETTINGS.lives, 1, 5),
      topics: { ...DEFAULT_SETTINGS.topics, ...(parsed.topics || {}) },
      numberType: NUMTYPE_LABELS[parsed.numberType] ? parsed.numberType : DEFAULT_SETTINGS.numberType,
    };
  } catch {
    return structuredCloneSettings(DEFAULT_SETTINGS);
  }
}

function structuredCloneSettings(s) {
  return { ...s, topics: { ...s.topics } };
}

function saveSettings() {
  localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings));
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

const HEART_PATH = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

function heartSVG(extraClass) {
  const cls = 'life' + (extraClass ? ' ' + extraClass : '');
  return `<svg class="${cls}" viewBox="0 0 24 24"><path d="${HEART_PATH}"/></svg>`;
}

let settings = loadSettings();

// ---- runtime state ----
let lives = settings.lives;
let streak = 0;
// Guests: best streak lives only in memory, wiped on refresh.
// Logged-in users: loaded from / saved to Supabase in checkSession()/saveBestStreak().
let best = 0;
let timeLeft = settings.time;
let timerId = null;
let currentAnswer = null;
let acceptingInput = true;

// ---- DOM refs ----
const screens = {
  start: document.getElementById('screen-start'),
  settings: document.getElementById('screen-settings'),
  game: document.getElementById('screen-game'),
  over: document.getElementById('screen-over'),
};

const el = {
  startBest: document.getElementById('start-best'),
  tagline: document.getElementById('tagline'),
  rulesPreview: document.getElementById('rules-preview'),

  hamburger: document.getElementById('btn-hamburger'),
  sidebar: document.getElementById('sidebar'),
  sidebarOverlay: document.getElementById('sidebar-overlay'),
  sidebarClose: document.getElementById('btn-sidebar-close'),

  accountBtn: document.getElementById('btn-account'),
  authOverlay: document.getElementById('auth-overlay'),
  authModal: document.getElementById('auth-modal'),
  authClose: document.getElementById('btn-auth-close'),
  authTitle: document.getElementById('auth-title'),
  authEmail: document.getElementById('auth-email'),
  authPassword: document.getElementById('auth-password'),
  authError: document.getElementById('auth-error'),
  authSubmit: document.getElementById('btn-auth-submit'),
  authToggleText: document.getElementById('auth-toggle-text'),
  authToggleBtn: document.getElementById('btn-auth-toggle'),

  likeBtn: document.getElementById('btn-like'),
  likeLabel: document.getElementById('like-label'),
  likeCount: document.getElementById('like-count'),

  speedSlider: document.getElementById('speed-slider'),
  speedValue: document.getElementById('speed-value'),
  livesValue: document.getElementById('lives-value'),
  heartsPicker: document.getElementById('hearts-picker'),
  topicsGroup: document.getElementById('topics-group'),
  topicsHint: document.getElementById('topics-hint'),
  numtypeGroup: document.getElementById('numtype-group'),

  livesBox: document.getElementById('lives'),
  streak: document.getElementById('streak'),
  best: document.getElementById('best'),
  timerFill: document.getElementById('timer-fill'),
  questionType: document.getElementById('question-type'),
  questionText: document.getElementById('question-text'),
  form: document.getElementById('answer-form'),
  input: document.getElementById('answer-input'),
  feedback: document.getElementById('feedback'),
  finalStreak: document.getElementById('final-streak'),
  finalBest: document.getElementById('final-best'),
  newBestMsg: document.getElementById('new-best-msg'),
};

document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-retry').addEventListener('click', startGame);
document.getElementById('btn-menu').addEventListener('click', goToMenu);
document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('btn-settings-back').addEventListener('click', goToMenu);
document.getElementById('btn-settings-reset').addEventListener('click', resetSettings);
el.form.addEventListener('submit', handleSubmit);
el.speedSlider.addEventListener('input', handleSpeedChange);

el.hamburger.addEventListener('click', openSidebar);
el.sidebarClose.addEventListener('click', closeSidebar);
el.sidebarOverlay.addEventListener('click', closeSidebar);

function openSidebar() {
  el.sidebar.classList.add('open');
  el.sidebarOverlay.classList.add('open');
}

function closeSidebar() {
  el.sidebar.classList.remove('open');
  el.sidebarOverlay.classList.remove('open');
}

// ---- likes (global count via Supabase) ----
// 1 call on page load to read the count, 1 call per click. No polling.
async function loadLikeCount() {
  if (!sb) return;
  const { data, error } = await sb.from('app_stats').select('likes_count').eq('id', 1).single();
  if (!error && data) el.likeCount.textContent = data.likes_count;
}

function setLikeState(liked) {
  el.likeBtn.classList.toggle('liked', liked);
  el.likeBtn.setAttribute('aria-pressed', String(liked));
  el.likeLabel.textContent = liked ? 'Liked' : 'Like this app';
}

async function toggleLikeRemote() {
  if (!sb) return;
  const liked = localStorage.getItem('blitzstreak_liked') === 'true';
  const fn = liked ? 'decrement_likes' : 'increment_likes';
  const { data, error } = await sb.rpc(fn);
  if (!error && data !== null) {
    el.likeCount.textContent = data;
    localStorage.setItem('blitzstreak_liked', String(!liked));
    setLikeState(!liked);
  }
}

el.likeBtn.addEventListener('click', toggleLikeRemote);
setLikeState(localStorage.getItem('blitzstreak_liked') === 'true');

// ---- auth (email + password via Supabase) ----
async function checkSession() {
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;
  updateAccountUI();
  if (currentUser) await loadBestStreak();
}

function updateAccountUI() {
  el.accountBtn.textContent = currentUser ? 'LOG OUT' : 'LOG IN';
}

async function loadBestStreak() {
  if (!sb) return;
  const { data, error } = await sb
    .from('profiles')
    .select('best_streak')
    .eq('id', currentUser.id)
    .single();

  if (!error && data) {
    // carry over any in-session guest progress if it beats the saved value
    if (best > data.best_streak) {
      await saveBestStreak();
    } else {
      best = data.best_streak;
    }
  } else {
    // first login for this user — create their profile row
    await saveBestStreak();
  }
  el.startBest.textContent = best;
}

async function saveBestStreak() {
  if (!sb || !currentUser) return; // guests: never written anywhere, wiped on refresh
  await sb.from('profiles').upsert({ id: currentUser.id, best_streak: best });
}

function openAuthModal() {
  el.authOverlay.classList.add('open');
  el.authModal.classList.add('open');
  el.authError.textContent = '';
  el.authEmail.value = '';
  el.authPassword.value = '';
}

function closeAuthModal() {
  el.authOverlay.classList.remove('open');
  el.authModal.classList.remove('open');
}

function setAuthMode(mode) {
  authMode = mode;
  el.authTitle.textContent = mode === 'login' ? 'LOG IN' : 'SIGN UP';
  el.authSubmit.textContent = mode === 'login' ? 'LOG IN' : 'SIGN UP';
  el.authToggleText.textContent = mode === 'login' ? 'No account?' : 'Already have one?';
  el.authToggleBtn.textContent = mode === 'login' ? 'Sign up' : 'Log in';
  el.authError.textContent = '';
}

el.accountBtn.addEventListener('click', async () => {
  if (!sb) return;
  if (currentUser) {
    await sb.auth.signOut();
    currentUser = null;
    updateAccountUI();
  } else {
    setAuthMode('login');
    openAuthModal();
  }
});

el.authClose.addEventListener('click', closeAuthModal);
el.authOverlay.addEventListener('click', closeAuthModal);
el.authToggleBtn.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));

el.authSubmit.addEventListener('click', async () => {
  if (!sb) {
    el.authError.textContent = 'Login is temporarily unavailable.';
    return;
  }
  const email = el.authEmail.value.trim();
  const password = el.authPassword.value;
  el.authError.textContent = '';

  if (!email || !password) {
    el.authError.textContent = 'Enter an email and password.';
    return;
  }

  el.authSubmit.disabled = true;
  const { data, error } = authMode === 'login'
    ? await sb.auth.signInWithPassword({ email, password })
    : await sb.auth.signUp({ email, password });
  el.authSubmit.disabled = false;

  if (error) {
    el.authError.textContent = error.message;
    return;
  }

  if (!data.session) {
    // signup succeeded but email confirmation is required before login
    el.authError.textContent = 'Check your email to confirm your account, then log in.';
    return;
  }

  currentUser = data.user;
  updateAccountUI();
  closeAuthModal();
  await loadBestStreak();
});

// ---- font-flash fix ----
// Syne loads async; without this the title briefly renders in the
// fallback font then jumps to Syne, which reads as a glitch. Hide it
// until fonts are actually ready, then fade in already correct.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    document.documentElement.classList.add('fonts-loaded');
  });
  // safety net in case fonts.ready never resolves on some browsers
  setTimeout(() => document.documentElement.classList.add('fonts-loaded'), 1500);
} else {
  document.documentElement.classList.add('fonts-loaded');
}

// ---- screen management ----
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function goToMenu() {
  clearInterval(timerId);
  renderMenuPreview();
  showScreen('start');
}

function renderMenuPreview() {
  el.startBest.textContent = best;
  el.tagline.textContent = `${settings.time} seconds a question. ${settings.lives} ${settings.lives === 1 ? 'life' : 'lives'}. How long can you keep up?`;

  const activeTopics = Object.keys(settings.topics).filter(t => settings.topics[t]);
  el.rulesPreview.innerHTML = `
    <div class="rule">
      <span class="rule-num">TIME</span>
      <span class="rule-text">${settings.time}s per question</span>
    </div>
    <div class="rule">
      <span class="rule-num">LIVES</span>
      <span class="rule-text">${settings.lives} — lost on miss or timeout</span>
    </div>
    <div class="rule">
      <span class="rule-num">TOPICS</span>
      <span class="rule-text">${activeTopics.map(t => TOPIC_LABELS[t]).join(', ')}</span>
    </div>
    <div class="rule">
      <span class="rule-num">NUMBERS</span>
      <span class="rule-text">${NUMTYPE_LABELS[settings.numberType]}</span>
    </div>
  `;
}

// ---- settings screen ----
function openSettings() {
  closeSidebar();
  el.speedSlider.value = settings.time;
  el.speedValue.textContent = settings.time + 's';
  el.livesValue.textContent = settings.lives;
  renderHeartsPicker();
  renderTopicsGroup();
  renderNumtypeGroup();
  showScreen('settings');
}

function handleSpeedChange() {
  settings.time = Number(el.speedSlider.value);
  el.speedValue.textContent = settings.time + 's';
  saveSettings();
}

function renderHeartsPicker() {
  el.heartsPicker.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'heart-btn' + (i <= settings.lives ? ' filled' : '');
    btn.setAttribute('aria-label', `${i} ${i === 1 ? 'life' : 'lives'}`);
    btn.innerHTML = heartSVG();
    btn.addEventListener('click', () => {
      settings.lives = i;
      el.livesValue.textContent = settings.lives;
      saveSettings();
      renderHeartsPicker();
    });
    el.heartsPicker.appendChild(btn);
  }
}

function renderTopicsGroup() {
  el.topicsGroup.innerHTML = '';
  Object.keys(TOPIC_LABELS).forEach(key => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (settings.topics[key] ? ' active' : '');
    chip.textContent = TOPIC_LABELS[key];
    chip.addEventListener('click', () => {
      const activeCount = Object.values(settings.topics).filter(Boolean).length;
      if (settings.topics[key] && activeCount === 1) {
        el.topicsHint.textContent = 'Pick at least one topic.';
        return;
      }
      el.topicsHint.textContent = '';
      settings.topics[key] = !settings.topics[key];
      saveSettings();
      renderTopicsGroup();
    });
    el.topicsGroup.appendChild(chip);
  });
}

function renderNumtypeGroup() {
  el.numtypeGroup.innerHTML = '';
  Object.keys(NUMTYPE_LABELS).forEach(key => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (settings.numberType === key ? ' active' : '');
    chip.textContent = NUMTYPE_LABELS[key];
    chip.addEventListener('click', () => {
      settings.numberType = key;
      saveSettings();
      renderNumtypeGroup();
    });
    el.numtypeGroup.appendChild(chip);
  });
}

function resetSettings() {
  settings = structuredCloneSettings(DEFAULT_SETTINGS);
  saveSettings();
  openSettings();
}

// ---- question generation (8th grade level) ----

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

// Generates a number honoring the current number-type setting:
// whole = non-negative integers, integer = signed integers,
// rational = signed numbers with one decimal place.
function genNumber(min, max) {
  let lo = min;
  if (settings.numberType === 'whole') lo = Math.max(0, min);
  let n = randInt(lo, max);
  if (settings.numberType === 'rational') {
    const tenths = randInt(0, 9) / 10;
    n = n + (n < 0 ? -tenths : tenths);
    n = Math.round(n * 10) / 10;
  }
  return n;
}

const generatorsByTopic = {
  arithmetic: [
    function addSub() {
      const a = genNumber(-20, 20);
      const b = genNumber(-20, 20);
      const op = pick(['+', '-']);
      const answer = Math.round((op === '+' ? a + b : a - b) * 10) / 10;
      return { type: 'arithmetic', text: `${a} ${op} ${b}`, answer };
    },
    function multiply() {
      const a = genNumber(-12, 12);
      const b = genNumber(-12, 12);
      const answer = Math.round(a * b * 10) / 10;
      return { type: 'arithmetic', text: `${a} × ${b}`, answer };
    },
    function divide() {
      // built to divide evenly, so decimals only ever come from the
      // number-type setting itself, not messy remainders
      const b = randInt(-12, 12) || 2;
      const answer = settings.numberType === 'whole' ? randInt(0, 12) : randInt(-12, 12);
      const a = b * answer;
      return { type: 'arithmetic', text: `${a} ÷ ${b}`, answer };
    },
  ],

  orderOfOps: [
    function orderOfOps() {
      const a = genNumber(2, 12);
      const b = genNumber(2, 12);
      const c = genNumber(2, 9);
      const forms = [
        { text: `${a} + ${b} × ${c}`, answer: a + b * c },
        { text: `(${a} + ${b}) × ${c}`, answer: (a + b) * c },
        { text: `${a} × ${b} - ${c}`, answer: a * b - c },
        { text: `${a} - ${b} × ${c}`, answer: a - b * c },
      ];
      const f = pick(forms);
      return { type: 'order of operations', text: f.text, answer: Math.round(f.answer * 100) / 100 };
    },
  ],

  exponents: [
    function exponents() {
      const base = genNumber(settings.numberType === 'whole' ? 0 : -9, 9) || 2;
      const exp = 2;
      return { type: 'exponents', text: `${base}^${exp}`, answer: Math.round(Math.pow(base, exp) * 100) / 100 };
    },
  ],

  squareRoots: [
    function squareRoots() {
      // always a clean perfect square so the answer is a whole number,
      // regardless of the number-type setting
      const root = randInt(2, 15);
      return { type: 'square roots', text: `√${root * root}`, answer: root };
    },
  ],

  equations: [
    function oneStepEquation() {
      const x = genNumber(-15, 15);
      const b = genNumber(-20, 20);
      const type = pick(['add', 'sub', 'mult']);
      if (type === 'add') {
        const sum = Math.round((x + b) * 10) / 10;
        return { type: 'solve for x', text: `x + ${b} = ${sum}`, answer: x };
      }
      if (type === 'sub') {
        const diff = Math.round((x - b) * 10) / 10;
        return { type: 'solve for x', text: `x - ${b} = ${diff}`, answer: x };
      }
      const m = randInt(-9, 9) || 2;
      const prod = Math.round(x * m * 10) / 10;
      return { type: 'solve for x', text: `${m}x = ${prod}`, answer: x };
    },
  ],
};

function activeGenerators() {
  const pools = Object.keys(settings.topics)
    .filter(key => settings.topics[key])
    .map(key => generatorsByTopic[key]);
  const flat = pools.flat();
  return flat.length ? flat : generatorsByTopic.arithmetic;
}

function nextQuestion() {
  const q = pick(activeGenerators())();
  currentAnswer = q.answer;
  el.questionType.textContent = q.type;
  el.questionText.textContent = q.text;
  el.input.value = '';
  el.feedback.textContent = '';
  el.feedback.className = 'feedback';
  acceptingInput = true;
  el.input.focus();
  startTimer();
}

// ---- timer ----
function startTimer() {
  clearInterval(timerId);
  timeLeft = settings.time;
  updateTimerBar();
  timerId = setInterval(() => {
    timeLeft -= 0.1;
    if (timeLeft <= 0) {
      timeLeft = 0;
      updateTimerBar();
      clearInterval(timerId);
      handleTimeout();
    } else {
      updateTimerBar();
    }
  }, 100);
}

function updateTimerBar() {
  const pct = (timeLeft / settings.time) * 100;
  el.timerFill.style.width = pct + '%';
  el.timerFill.classList.toggle('urgent', timeLeft <= Math.min(3, settings.time * 0.3));
}

// ---- answer handling ----
function handleSubmit(e) {
  e.preventDefault();
  if (!acceptingInput) return;

  const raw = el.input.value.trim();
  if (raw === '') return;

  const guess = Number(raw);
  const correct = !Number.isNaN(guess) && Math.abs(guess - currentAnswer) < 0.05;

  clearInterval(timerId);
  acceptingInput = false;

  if (correct) {
    handleCorrect();
  } else {
    handleWrong();
  }
}

function handleCorrect() {
  streak++;
  if (streak > best) {
    best = streak;
    saveBestStreak(); // no-op for guests — their progress lives only in this tab
  }
  updateHud();
  el.feedback.textContent = 'correct';
  el.feedback.className = 'feedback correct';
  setTimeout(nextQuestion, CORRECT_DELAY);
}

function handleWrong() {
  el.feedback.textContent = `not quite — answer was ${currentAnswer}`;
  el.feedback.className = 'feedback wrong';
  loseLife();
}

function handleTimeout() {
  acceptingInput = false;
  el.feedback.textContent = `time's up — answer was ${currentAnswer}`;
  el.feedback.className = 'feedback wrong';
  loseLife();
}

function loseLife() {
  lives--;
  updateHud();
  if (lives <= 0) {
    setTimeout(gameOver, MISS_DELAY);
  } else {
    setTimeout(nextQuestion, MISS_DELAY);
  }
}

// ---- HUD ----
function updateHud() {
  el.streak.textContent = streak;
  el.best.textContent = best;
  let html = '';
  for (let i = 0; i < settings.lives; i++) {
    html += heartSVG(i >= lives ? 'lost' : '');
  }
  el.livesBox.innerHTML = html;
}

// ---- game flow ----
function startGame() {
  closeSidebar();
  lives = settings.lives;
  streak = 0;
  updateHud();
  showScreen('game');
  nextQuestion();
}

function gameOver() {
  clearInterval(timerId);
  showScreen('over');
  el.finalStreak.textContent = streak;
  el.finalBest.textContent = best;
  el.newBestMsg.classList.toggle('show', streak === best && streak > 0);
}

// ---- init ----
renderMenuPreview();
showScreen('start');
checkSession();
loadLikeCount();