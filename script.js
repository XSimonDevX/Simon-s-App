// === ELEMENTS ===
const addBtn = document.getElementById("addBtn");
const imageInput = document.getElementById("imageInput");
const textInput = document.getElementById("textInput");
const cardContainer = document.getElementById("cardContainer");
const sentenceArea = document.getElementById("sentenceArea");
const playAllBtn = document.getElementById("playAll");
const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const previewAudio = document.getElementById("previewAudio");

let mediaRecorder;
let audioChunks = [];
let currentAudioBlob = null;

// Playback speed settings
const TTS_RATE = 1.25;   // 1.0 = normal; try 1.15–1.4
const AUDIO_RATE = 1.25; // for recorded audio blobs
const PLAY_GAP_MS = 800; // gap between cards during Play All


// ===== Haptics =====
function vibrate(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

// ===== Drag-to-reorder helpers =====
let draggingEl = null;
function makeSentenceDraggable(el) {
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    draggingEl = el;
    el.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/sentence", "1"); // mark internal drag
  });
  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
    draggingEl = null;
  });
}
// --- Auto-fit a <p> label so it fits on one line inside its card ---
function fitLabelToCard(p, { max = 20, min = 12 } = {}) {
  if (!p) return;
  const parent = p.parentElement;
  if (!parent) return;

  // start big; inline style overrides CSS
  let size = max;
  p.style.fontSize = size + "px";

  // available width (avoid flush to rounded corners)
  const maxWidth = Math.max(0, parent.clientWidth - 12);

  // shrink until the rendered text fits or we hit the minimum
  // use getBoundingClientRect/scrollWidth so we measure real width
  // run a bounded loop to avoid edge cases
  let safety = 30;
  while (safety-- > 0 && size > min && p.scrollWidth > maxWidth) {
    size -= 1;
    p.style.fontSize = size + "px";
  }
}

// Fit after DOM/layout settles
function fitLabelToCardAsync(p, opts) {
  requestAnimationFrame(() => fitLabelToCard(p, opts));
}

function refitAllLabels() {
  document.querySelectorAll("#themeContainer .card p, #cardContainer .card p, #sentenceArea .card p")
    .forEach(p => fitLabelToCard(p));
}

// Refit on rotation/resize
addEventListener("resize", () => {
  clearTimeout(window.__fitTimer);
  window.__fitTimer = setTimeout(refitAllLabels, 120);
});


// Refit when the viewport changes (rotate phone/tablet)
window.addEventListener("resize", () => {
  // debounce for performance
  clearTimeout(window.__fitTimer);
  window.__fitTimer = setTimeout(refitAllLabels, 120);
});

// Touch-friendly removal: long-press & double-tap on a card
function attachRemovalGestures(el) {
  let pressTimer, moved = false;
  const start = () => {
    moved = false;
    pressTimer = setTimeout(() => { vibrate(30); el.remove(); }, 600); // long-press
  };
  const move = () => { moved = true; };
  const cancel = () => clearTimeout(pressTimer);

  el.addEventListener("touchstart", start, { passive: true });
  el.addEventListener("touchmove", move, { passive: true });
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
  el.addEventListener("mousedown", start);
  el.addEventListener("mouseup", cancel);
  el.addEventListener("mouseleave", cancel);

  let lastTap = 0;
  el.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 300 && !moved) { vibrate(20); el.remove(); } // double-tap
    lastTap = now;
  });
}

// ===== IndexedDB helpers =====
const DB_NAME = "flashcardsDB";
const STORE = "cards";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        os.createIndex("text", "text", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addCardToDB(card) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(card);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllCardsFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getCardByTextFromDB(text) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("text");
    const req = idx.get(text); // first match
    req.onsuccess = () => resolve(req.result || null);
    req.onerror  = () => reject(req.error);
  });
}

// Downscale images to keep storage small (max dimension 512px)
function downscaleImage(file, maxSize = 512) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.85);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function urlFor(blob) { return blob ? URL.createObjectURL(blob) : ""; }

// ===== Microphone recording =====
recordBtn.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      currentAudioBlob = new Blob(audioChunks, { type: "audio/webm" });
      previewAudio.src = urlFor(currentAudioBlob);
    };
    mediaRecorder.start();
    recordBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (err) {
    alert("Microphone permission is required to record audio.");
    console.error(err);
  }
});

stopBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    recordBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

// ===== Add Card (IndexedDB) =====
addBtn.addEventListener("click", async () => {
  const file = imageInput.files[0];
  const text = textInput.value.trim();
  if (!file || !text) {
    alert("Add an image and a word!");
    return;
  }
  try {
    const imgBlob = await downscaleImage(file, 512);
    const card = { text, imageBlob: imgBlob, audioBlob: currentAudioBlob || null };
    await addCardToDB(card);
    await displayCards();

    textInput.value = "";
    imageInput.value = "";
    previewAudio.src = "";
    currentAudioBlob = null;
  } catch (e) {
    console.error(e);
    alert("Failed to add card: " + e.message);
  }
});

// --- Helper: delete a card safely (by id if available, otherwise by matching text) ---
async function deleteCardFromDB(card) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);

    if (card.id != null) {
      store.delete(card.id);
    } else {
      // fallback for older cards (match by text)
      const idx = store.index("text");
      const req = idx.openCursor(card.text);
      req.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (cursor) {
          cursor.delete();
        }
      };
      req.onerror = () => reject(req.error);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function displayCards() {
  const cards = await getAllCardsFromDB();
  cardContainer.innerHTML = "";

  for (const card of cards) {
    const imgURL = card.imageBlob ? urlFor(card.imageBlob) : "";

    // Render HTML with a real delete button element in it
    const div = document.createElement("div");
    div.className = "card";
    div.draggable = true;
    div.dataset.id = card.id ?? "";          // for delete lookup
    div.dataset.text = card.text;

    div.innerHTML = `
      ${imgURL ? `<img src="${imgURL}" alt="${card.text}" style="pointer-events:none">` : ""}
      <p>${card.text}</p>
      <button class="delete-btn" title="Delete">✖</button>
    `;
    // speak on tap
    div.addEventListener("click", () => playCard(card, div));
    // drag support
    div.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ text: card.text, image: imgURL }));
    });

    cardContainer.appendChild(div);
  }

  // Optional: tweak label sizing after render
  requestAnimationFrame(() => {
    document
      .querySelectorAll("#cardContainer .card p")
      .forEach(p => { p.style.fontSize = "15px"; });
  });
}
// One listener to handle all current/future delete buttons
cardContainer.addEventListener("click", async (e) => {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;

  e.stopPropagation();
  e.preventDefault();

  const cardEl = btn.closest(".card");
  const id = cardEl.dataset.id ? Number(cardEl.dataset.id) : null;
  const text = cardEl.dataset.text || "";

  if (!confirm(`Delete "${text}"?`)) return;

  // Build a minimal "card" object for the helper
  const toDelete = id != null ? { id, text } : { text };

  try {
    await deleteCardFromDB(toDelete);
    await displayCards();
  } catch (err) {
    console.error(err);
    alert("Failed to delete card: " + err.message);
  }
});

// ===== Speak / Play =====
function playCard(card, element) {
  if (element) highlight(element);

  // 1) Use recorded audio if present
  if (card && card.audioBlob) {
    const audio = new Audio(urlFor(card.audioBlob));
    audio.playbackRate = (typeof AUDIO_RATE === "number" ? AUDIO_RATE : 1.0);
    audio.play();
    return;
  }

  // 2) Otherwise use TTS
  if (card && card.text) {
    let phrase = card.text.trim();

    // Tiny pause helps short words (dog/cat/pig) be fully pronounced
    if (phrase.length <= 3) phrase += ".";

    const utter = new SpeechSynthesisUtterance(phrase);

    // Base rate, then slightly slower for very short words
    const baseRate = (typeof TTS_RATE === "number" ? TTS_RATE : 1.0);
    utter.rate = (phrase.length <= 3) ? Math.max(0.5, baseRate * 0.9) : baseRate;

    // Child-like pitch if you want (adjust or remove)
    utter.pitch = 1.0;
    utter.volume = 1.0;

    // Use selected voice if available (set BEFORE speak)
    if (typeof selectedVoice !== "undefined" && selectedVoice) {
      utter.voice = selectedVoice;
    }

    // Speak (cancel any lingering utterances first)
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  }
}


function highlight(element) {
  element.classList.add("playing");
  setTimeout(() => element.classList.remove("playing"), 800);
}

// ===== DRAG & DROP in Sentence Area =====
sentenceArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (draggingEl) {
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("#sentenceArea .card");
    if (!target || target === draggingEl) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    sentenceArea.insertBefore(draggingEl, before ? target : target.nextSibling);
  }
});

sentenceArea.addEventListener("drop", async (e) => {
  // If this was an internal drag (reorder), nothing else to do
  if (e.dataTransfer.getData("text/sentence")) return;

  // Otherwise it's a new card being dropped in
  const json = e.dataTransfer.getData("text/plain");
  let partial;
  try { partial = JSON.parse(json); } catch { partial = null; }

  // If we have text, try to load the full card (with audioBlob) from IndexedDB
  let fullCard = null;
  if (partial && partial.text) {
    try { fullCard = await getCardByTextFromDB(partial.text); } catch {}
  }

  // Prefer full card (with audioBlob) else fall back to the partial (themes have no audio)
  const cardToUse = fullCard || partial;
  if (cardToUse) addToSentence(cardToUse);
});

function addToSentence(card) {
  const div = document.createElement("div");
  div.className = "card";

  // --- Handle display content ---
  if (card.icon) {
    // Themed emoji card
    const emoji = document.createElement("div");
    emoji.textContent = card.icon;
    emoji.style.fontSize = "48px";
    emoji.style.marginBottom = "6px";
    div.appendChild(emoji);

  } else if (card.imageBlob instanceof Blob) {
    // IndexedDB photo card (custom recorded card)
    const img = document.createElement("img");
    img.src = URL.createObjectURL(card.imageBlob);
    img.onload = () => URL.revokeObjectURL(img.src); // cleanup blob URL
    div.appendChild(img);

  } else if (card.image) {
    // Regular photo card (themes or in-memory)
    const img = document.createElement("img");
    img.src = card.image;
    div.appendChild(img);
  }

  // --- Add text ---
  const textEl = document.createElement("p");
  textEl.textContent = card.text;
  div.appendChild(textEl);

  // --- Delete button ---
  const del = document.createElement("button");
  del.className = "delete-btn";
  del.textContent = "✖";
  del.title = "Remove";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    vibrate(20);
    div.remove();
  });
  div.appendChild(del);

  // --- Interactivity ---
  div.addEventListener("click", () => playCard(card, div));
  makeSentenceDraggable(div);
  attachRemovalGestures(div); // long-press & double-tap for mobile
  sentenceArea.appendChild(div);
}


// ===== Play All =====
playAllBtn.addEventListener("click", async () => {
  const sentenceCards = [...sentenceArea.querySelectorAll(".card")];
  for (const div of sentenceCards) {
    const text = div.querySelector("p").textContent;
    playCard({ text }, div);
    await new Promise(r => setTimeout(r, PLAY_GAP_MS)); // faster gap
  }
});

// ===== Ensure Clear button exists (creates if missing) =====
let clearBtn = document.getElementById("clearSentence");
if (!clearBtn) {
  playAllBtn.insertAdjacentHTML("afterend", ' <button id="clearSentence">🗑️ Clear</button>');
  clearBtn = document.getElementById("clearSentence");
}
clearBtn.addEventListener("click", () => {
  sentenceArea.innerHTML = "";
  vibrate(30);
});

// ===== Themes with centered emoji =====
const themeSets = {
  food: [
    { image: "./img/ice-cream.png", text: "ice-cream", icon: "🍦" },
    { image: "./img/apple.png", text: "apple", icon: "🍎" },
    { image: "./img/orange.png", text: "orange", icon: "🍊" },
    { image: "./img/banana.png", text: "banana", icon: "🍌" },
    { image: "./img/strawberry.png", text: "strawberry", icon: "🍓" },
    { image: "./img/cookies.png", text: "cookies", icon: "🍪" } // (spelling)
  ],
  clothes: [
    { image: "./img/tshirt.png", text: "t-shirt", icon: "👕" },
    { image: "./img/pants.png", text: "pants", icon: "👖" },
    { image: "./img/shoes.png", text: "shoes", icon: "👟" },
    { image: "./img/hat.png", text: "hat", icon: "🧢" },
    { image: "./img/socks.png", text: "socks", icon: "🧦" }
  ],
  places: [
    { image: "./img/beach.png", text: "beach", icon: "🏖️" },
    { image: "./img/home.png", text: "home", icon: "🏠" },
    { image: "./img/school.png", text: "school", icon: "🏫" },
    { image: "./img/playground.png", text: "playground", icon: "🛝" },
    { image: "./img/shop.png", text: "shop", icon: "🛒" }
  ],
  people: [
    { image: "./img/boy.png", text: "boy", icon: "👦🏻" },
    { image: "./img/girl.png", text: "girl", icon: "👧🏻" },
    { image: "./img/mom.png", text: "mommy", icon: "👩‍🦰" },
    { image: "./img/dad.png", text: "daddy", icon: "👨‍🦰" },
    { image: "./img/grandma.png", text: "ya-ya", icon: "👵🏼" } // ideally use a grandma image
  ],
  colours: [
    { text: "red",    icon: "🟥" },
    { text: "blue",   icon: "🟦" },
    { text: "green",  icon: "🟩" },
    { text: "yellow", icon: "🟨" },
    { text: "purple", icon: "🟪" },
    { text: "orange", icon: "🟧" },
    { text: "black",  icon: "⬛" },
    { text: "white",  icon: "⬜" },
    { text: "brown",  icon: "🟫" }
  ],
  vehicles: [
    { text: "car",      icon: "🚗" },
    { text: "bus",      icon: "🚌" },
    { text: "train",    icon: "🚆" },
    { text: "bike",     icon: "🚲" },
    { text: "airplane", icon: "✈️" },
    { text: "boat",     icon: "🛥️" },
    { text: "truck",    icon: "🚚" },
    { text: "scooter",  icon: "🛵" }
  ],
  feelings: [
    { text: "happy",   icon: "😊" },
    { text: "sad",     icon: "😢" },
    { text: "angry",   icon: "😠" },
    { text: "excited", icon: "🤩" },
    { text: "scared",  icon: "😨" },
    { text: "tired",   icon: "🥱" },
    { text: "sick",    icon: "🤒" },
    { text: "proud",   icon: "😌" },
    { text: "hurt",    icon: "🤕" }
  ],
  animals: [
    { text: "dog",      icon: "🐕" },
    { text: "cat",      icon: "🐈" },
    { text: "frog",     icon: "🐸" },
    { text: "elephant", icon: "🐘" },
    { text: "monkey",   icon: "🐒" },
    { text: "pig",      icon: "🐖" },
    { text: "cow",      icon: "🐄" },
    { text: "horse",    icon: "🐎" },
    { text: "snake",    icon: "🐍" }
  ]
};


// === Themes wiring (no HTML buttons needed) ===
const themeContainer = document.getElementById("themeContainer");

// Build the theme category buttons dynamically (at runtime)
function renderThemeButtons() {
  const themesSection = document.getElementById("themes");
  if (!themesSection) return;

  // Create a host row if it's missing
  let host = document.getElementById("themeButtons");
  if (!host) {
    host = document.createElement("div");
    host.id = "themeButtons";
    themesSection.insertBefore(host, themeContainer);
  }

  // Pretty labels with emojis
  const label = {
    food: "🍎 Food",
    clothes: "👕 Clothes",
    places: "🏠 Places",
    people: "🧍 People",
    colours: "🎨 Colours",
    vehicles: "🚗 Vehicles",
    feelings: "😊 Feelings",
    animals: "🐾 Animals",
  };

  host.innerHTML = "";
  Object.keys(themeSets).forEach((key) => {
    const btn = document.createElement("button");
    btn.className = "themeBtn";
    btn.dataset.theme = key;
    btn.textContent = label[key] || key;
    btn.addEventListener("click", () => showTheme(themeSets[key]));
    host.appendChild(btn);
  });
}

// Render one theme’s cards (works for emoji-only sets too)
function showTheme(set) {
  themeContainer.innerHTML = "";
  set.forEach((card) => {
    const div = document.createElement("div");
    div.className = "card";
    div.draggable = true;

    const hasImg = !!card.image;
    div.innerHTML = `
      ${hasImg ? `<img src="${card.image}" alt="${card.text || ""}">` : ""}
      <p>${card.text || ""}</p>
      <div class="badge">${card.icon || ""}</div>
    `;

    // Speak on tap (if text exists)
    div.addEventListener("click", () => {
      if (card.text) speechSynthesis.speak(new SpeechSynthesisUtterance(card.text));
    });

    // Enable drag into sentence area
    div.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify(card));
    });

    themeContainer.appendChild(div);
  });
}

// Ensure buttons exist and a default category shows (Food)
function ensureThemesReady() {
  renderThemeButtons();
  if (!themeContainer.children.length) {
    showTheme(themeSets.food);
  }
}

// 1) Prepare on page load
window.addEventListener("load", ensureThemesReady);

// 2) Also prepare whenever the user opens the Themes panel via top nav
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".tabBtn");
  if (btn && btn.dataset.target === "themes") {
    ensureThemesReady();
  }
});

function showTheme(set) {
  themeContainer.innerHTML = "";
  set.forEach(card => {
    const div = document.createElement("div");
    div.className = "card";
    div.draggable = true;
    div.innerHTML = `
      <img src="${card.image}" alt="${card.text}">
      <p>${card.text}</p>
      <div class="badge">${card.icon || ""}</div>
    `;
    // tap/click speaks the word
    div.addEventListener("click", () =>
      speechSynthesis.speak(new SpeechSynthesisUtterance(card.text))
    );
    // drag into sentence area
    div.addEventListener("dragstart", e =>
      e.dataTransfer.setData("text/plain", JSON.stringify(card))
    );
    themeContainer.appendChild(div);
  });
}

// ===== Core words =====
const coreContainer = document.getElementById("coreContainer");

// Type palette (edit colors if you like)
const typeColor = {
  pronoun:  "#b3d9ff", // light blue
  verb:     "#b3ffb3", // light green
  adjective:"#f6c6ff", // light pink/purple
  time:     "#ffd59e", // orange
  quantity: "#fff4b3", // pale yellow
  social:   "#ffd1dc", // rose
  place:    "#cde7ff", // sky blue
  need:     "#ffe6cc", // peach
  personal: "#e6e6ff"  // lavender
};

const coreWords = [
  // pronouns
  { text: "I", type: "pronoun" }, { text: "you", type: "pronoun" },
  { text: "me", type: "pronoun" }, { text: "it", type: "pronoun" },

  // verbs (actions)
  { text: "want", type: "verb" }, { text: "go", type: "verb" },
  { text: "stop", type: "verb" }, { text: "look", type: "verb" },
  { text: "see", type: "verb" }, { text: "play", type: "verb" },
  { text: "help", type: "verb" }, { text: "like", type: "verb" },

  // adjectives (describing)
  { text: "big", type: "adjective" }, { text: "small", type: "adjective" },
  { text: "fast", type: "adjective" }, { text: "slow", type: "adjective" },
  { text: "happy", type: "adjective" }, { text: "sad", type: "adjective" },
  { text: "tired", type: "adjective" }, { text: "nice", type: "adjective" },

  // time & tense
  { text: "now", type: "time" }, { text: "before", type: "time" },
  { text: "after", type: "time" }, { text: "yesterday", type: "time" },
  { text: "today", type: "time" }, { text: "tomorrow", type: "time" },
  { text: "was", type: "time" }, { text: "will", type: "time" }, { text: "later", type: "time" },

  // quantity / control
  { text: "more", type: "quantity" }, { text: "all done", type: "quantity" },
  { text: "one", type: "quantity" }, { text: "two", type: "quantity" },

  // social
  { text: "yes", type: "social" }, { text: "no", type: "social" },
  { text: "thank you", type: "social" }, { text: "sorry", type: "social" },

  // places & needs
  { text: "home", type: "place" }, { text: "school", type: "place" },
  { text: "toilet", type: "need" },

  // personal/favourite
  { text: "Noddy", type: "personal" }
];
window.coreWords = coreWords; // expose to the sentence builder

function displayCoreWords() {
  coreContainer.innerHTML = "";
  coreWords.forEach(word => {
    const div = document.createElement("div");
    div.className = "core-card";
    div.textContent = word.text;

    // color by type
    const bg = typeColor[word.type] || "#ffe6e6";
    div.style.background = bg;
    div.dataset.type = word.type || "";

    // interactivity
    div.draggable = true;
    div.addEventListener("click", () =>
      speechSynthesis.speak(new SpeechSynthesisUtterance(word.text))
    );
    div.addEventListener("dragstart", (e) =>
      e.dataTransfer.setData("text/plain", JSON.stringify({ text: word.text }))
    );

    coreContainer.appendChild(div);
  });
}

// === AUTO-SHRINK LABELS TO FIT ONE LINE ===
function shrinkToFit(p) {
  if (!p) return;
  const parent = p.parentElement;
  if (!parent) return;

  // Reset to default
  p.style.fontSize = "18px";

  const maxWidth = parent.clientWidth - 12;
  let size = 18;

  // Gradually shrink while too wide
  while (p.scrollWidth > maxWidth && size > 10) {
    size -= 1;
    p.style.fontSize = size + "px";
  }
}

function applyShrinkToAllLabels() {
  document.querySelectorAll("#themeContainer .card p, #cardContainer .card p, #sentenceArea .card p")
    .forEach(p => shrinkToFit(p));
}

// Run after everything is drawn
window.addEventListener("load", () => setTimeout(applyShrinkToAllLabels, 300));
window.addEventListener("resize", () => setTimeout(applyShrinkToAllLabels, 300));

// === Voice Selection ===
const voiceSelect = document.getElementById("voiceSelect");
let availableVoices = [];
let selectedVoice = null;

// Load available voices
function populateVoiceList() {
  availableVoices = speechSynthesis.getVoices();

  // Clear old options
  if (voiceSelect) {
    voiceSelect.innerHTML = "";

    availableVoices.forEach((voice, i) => {
      const option = document.createElement("option");
      option.value = i;
      option.textContent = `${voice.name} (${voice.lang})${voice.default ? " ⭐" : ""}`;
      voiceSelect.appendChild(option);
    });

    // Select default voice
    if (availableVoices.length > 0) {
      voiceSelect.selectedIndex = availableVoices.findIndex(v => v.default) || 0;
      selectedVoice = availableVoices[voiceSelect.selectedIndex];
    }
  }
}

// Some browsers load voices asynchronously
speechSynthesis.onvoiceschanged = populateVoiceList;
populateVoiceList();

// Update selected voice when user changes dropdown
if (voiceSelect) {
  voiceSelect.addEventListener("change", () => {
    selectedVoice = availableVoices[voiceSelect.value];
  });
}

// === Panel Show/Hide Logic ===
const panels = Array.from(document.querySelectorAll("section.panel"));
const tabButtons = Array.from(document.querySelectorAll("#topBar .tabBtn"));

function showPanel(id) {
  panels.forEach(sec => sec.classList.remove("active"));
  tabButtons.forEach(btn => btn.classList.remove("active"));

  const panel = document.getElementById(id);
  const btn = tabButtons.find(b => b.dataset.target === id);

  if (panel) panel.classList.add("active");
  if (btn) {
    btn.classList.add("active");
    btn.setAttribute("aria-expanded", "true");
  }

  // Close others for accessibility
  tabButtons.filter(b => b !== btn).forEach(b => b.setAttribute("aria-expanded", "false"));

  // Save last open panel
  try { localStorage.setItem("lastPanel", id); } catch {}
}

function closePanel(id) {
  const panel = document.getElementById(id);
  const btn = tabButtons.find(b => b.dataset.target === id);
  if (panel) panel.classList.remove("active");
  if (btn) {
    btn.classList.remove("active");
    btn.setAttribute("aria-expanded", "false");
  }
}

// Toggle panel visibility on click
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.target;
    const panel = document.getElementById(id);
    const open = panel.classList.contains("active");
    open ? closePanel(id) : showPanel(id);
  });
});

// Allow closing with the ✖ button
document.addEventListener("click", e => {
  const close = e.target.closest(".panelClose");
  if (!close) return;
  closePanel(close.dataset.close);
});

// Allow closing with Escape key
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    const open = panels.find(p => p.classList.contains("active"));
    if (open) closePanel(open.id);
  }
});

// Open the last panel (or Core Words) on load
window.addEventListener("load", () => {
  const saved = localStorage.getItem("lastPanel") || "coreWords";
  showPanel(saved);
});

// === Auto-open the picker when Build panel is shown ===
document.querySelectorAll("#topBar .tabBtn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.target === "sentence") {
      if (typeof renderQuickWords === "function") renderQuickWords();
      if (typeof openPicker === "function") openPicker("core");
    }
  });
});

// If the app loads with the Build panel already active
window.addEventListener("load", () => {
  const last = localStorage.getItem("lastPanel");
  if (last === "sentence") {
    if (typeof renderQuickWords === "function") renderQuickWords();
    if (typeof openPicker === "function") openPicker("core");
  }
});


// ===== Fix: Dynamic body padding under fixed nav =====
window.addEventListener("load", () => {
  const bar = document.getElementById("topBar");
  if (!bar) return;
  
  // Add padding below nav height so content never hides underneath
  document.body.style.paddingTop = bar.offsetHeight + 20 + "px";
});

window.addEventListener("resize", () => {
  const bar = document.getElementById("topBar");
  if (!bar) return;
  document.body.style.paddingTop = bar.offsetHeight + 20 + "px";
});


// Make sure content starts below the fixed nav (no overlap)
function fitBodyBelowNav(){
  const bar = document.getElementById('topBar');
  if (!bar) return;
  document.body.style.paddingTop = (bar.offsetHeight + 12) + 'px';
}
window.addEventListener('load', fitBodyBelowNav);
window.addEventListener('resize', () => setTimeout(fitBodyBelowNav, 50));


// --- Safety shim: make sure window.coreWords is an array of {text,...} ---
(function ensureCoreWordsArray(){
  // prefer an existing global
  let cw = window.coreWords;

  if (Array.isArray(cw)) {
    // looks good
    return;
  }

  if (cw && typeof cw === "object") {
    
    // convert object/dictionary into array
    const arr = Object.values(cw).map(v => {
      if (typeof v === "string") return { text: v };
      if (v && typeof v === "object" && "text" in v) return v;
      return { text: String(v) };
    });
    window.coreWords = arr;
    return;
  }

  // fallback: define minimal list so UI still works
  window.coreWords = [
    { text: "I" }, { text: "you" }, { text: "me" },
    { text: "want" }, { text: "go" }, { text: "help" },
    { text: "yes" }, { text: "no" }, { text: "now" }, { text: "later" }
  ];
})();


/* ======================
   QUICK WORDS + PICKER
   ====================== */

// 1) Quick Words: small, always-available chips
const QUICK_WORDS = [
  "I","you","me","want","go","help","more","all done","yes","no","now","later","thank you"
];

function renderQuickWords() {
  const strip = document.getElementById("quickStrip");
  if (!strip) return;
  strip.innerHTML = "";
  QUICK_WORDS.forEach(t => {
    const chip = document.createElement("button");
    chip.className = "qw-chip";
    chip.textContent = t;
    chip.draggable = true;

    // click = add immediately
    chip.addEventListener("click", () => addToSentence({ text: t }));

    // drag into sentence area
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ text: t }));
    });

    strip.appendChild(chip);
  });
}

// 2) Picker drawer: tabs Core / Themes / My Cards
const picker          = document.getElementById("builderPicker");
const pickerGrid      = document.getElementById("pickerGrid");
const themeBtnsHost   = document.getElementById("pickerThemeButtons");
const togglePickerBtn = document.getElementById("togglePicker");
const closePickerBtn  = document.getElementById("closePicker");

function openPicker(tab = "core") {
  if (!picker) return;
  picker.classList.remove("hidden");
  picker.setAttribute("aria-hidden", "false");
  setActivePickerTab(tab);
  renderPickerTab(tab);
}

function closePicker() {
  if (!picker) return;
  picker.classList.add("hidden");
  picker.setAttribute("aria-hidden", "true");
}

function setActivePickerTab(tab) {
  document.querySelectorAll(".pickTab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
}

async function renderPickerTab(tab) {
  if (!pickerGrid) return;
  pickerGrid.innerHTML = "";
  if (themeBtnsHost) themeBtnsHost.innerHTML = "";

  if (tab === "core") {
    
  // safely handle any format of coreWords
  const list = Array.isArray(window.coreWords)
    ? window.coreWords
    : (typeof window.coreWords === "object"
        ? Object.values(window.coreWords)
        : []);

  list.forEach(w => {
    const text = typeof w === "string" ? w : w.text;
    const div = document.createElement("div");
    div.className = "picker-item";
    div.innerHTML = `<p>${text}</p>`;
    div.draggable = true;
    div.addEventListener("click", () => addToSentence({ text }));
    div.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ text }));
    });
    pickerGrid.appendChild(div);
  });
  return;
}


  if (tab === "themes") {
  // build mini theme buttons then show default (food)
  const labels = {
    food:"🍎 Food", clothes:"👕 Clothes", places:"🏠 Places",
    people:"🧍 People", colours:"🎨 Colours", vehicles:"🚗 Vehicles",
    feelings:"😊 Feelings", animals:"🐾 Animals"
  };

  if (themeBtnsHost) themeBtnsHost.innerHTML = "";

  Object.keys(themeSets).forEach(key => {
    const b = document.createElement("button");
    b.className = "miniThemeBtn";
    b.textContent = labels[key] || key;
    b.addEventListener("click", () => renderThemeSetInPicker(themeSets[key]));
    themeBtnsHost.appendChild(b);
  });

  renderThemeSetInPicker(themeSets.food);
  return;
}

if (tab === "cards") {
  // load custom cards from IndexedDB
  const cards = await getAllCardsFromDB();
  cards.forEach(card => {
    const div = document.createElement("div");
    div.className = "picker-item";
    const hasImg = !!card.imageBlob;
    div.innerHTML = `
      ${hasImg ? `<img class="picker-thumb" src="${URL.createObjectURL(card.imageBlob)}" alt="${card.text}">` : ""}
      <p>${card.text}</p>`;
    div.draggable = true;

    div.addEventListener("click", () => addToSentence(card));
    div.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ text: card.text }));
    });

    pickerGrid.appendChild(div);
  });
  return;
}


// ✅ THEMES: emoji + optional image + label
function renderThemeSetInPicker(set) {
  pickerGrid.innerHTML = "";
  (set || []).forEach(card => {
    const div = document.createElement("div");
    div.className = "picker-item";

    // Emoji (if provided)
    if (card.icon) {
      const emoji = document.createElement("div");
      emoji.className = "picker-emoji";
      emoji.textContent = card.icon;
      div.appendChild(emoji);
    }

    // Optional image (hide if broken)
    if (card.image) {
      const img = document.createElement("img");
      img.className = "picker-thumb";
      img.alt = card.text || "";
      img.src = card.image;
      img.onerror = () => { img.style.display = "none"; },
      div.appendChild(img);
    }

    // Label
    const p = document.createElement("p");
    p.textContent = card.text || "";
    div.appendChild(p);

    // Interactions
    div.draggable = true;
    div.addEventListener("click", () => addToSentence(card));
    div.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", JSON.stringify(card));
    });

    pickerGrid.appendChild(div);
  });
}

// 3) Wire up buttons
if (togglePickerBtn) togglePickerBtn.addEventListener("click", () => openPicker("core"));
if (closePickerBtn)  closePickerBtn.addEventListener("click", closePicker);
document.querySelectorAll(".pickTab").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    setActivePickerTab(tab);
    renderPickerTab(tab);
  });
});

// 4) Initialize Quick Words on load
window.addEventListener("load", renderQuickWords);


// ===== INIT =====
(async function init() {
  await displayCards();
  displayCoreWords();
})();
