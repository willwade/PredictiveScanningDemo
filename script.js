// Initialize vocabulary and PPM model
const maxOrder = 3; // Max context length for predictions

// Initialize the model and load training data
async function initializeModel() {
  try {
    const response = await fetch('training_data.txt');
    const trainingText = await response.text();
    console.log('Training text loaded:', trainingText.slice(0, 100) + '...');
    
    // Train vocabulary and initialize PPM model
    window.vocab.trainOnText(trainingText);
    console.log('Vocabulary after training:', 
      'Symbols:', window.vocab.symbols_,
      'Words:', Array.from(window.vocab.words));
    
    // Initialize PPM model after training
    const ppm = new window.PPMLanguageModel(window.vocab, maxOrder);
    const context = ppm.createContext();
    
    // Train PPM model on the text
    const chars = trainingText.split('');
    chars.forEach(char => {
      const symbolIndex = window.vocab.getSymbolIndex(char);
      if (symbolIndex !== -1) {
        ppm.addSymbolAndUpdate(context, symbolIndex);
      }
    });
    
    // Debug: Print the trie
    console.log('PPM Model Trie after training:');
    ppm.printToConsole();
    
    return { ppm, context };
  } catch (error) {
    console.error('Error loading training data:', error);
    return null;
  }
}

// Initialize UI elements
const gridElement = document.getElementById("letter-grid");
const messageElement = document.getElementById("message");
const speakBtn = document.getElementById("speak-btn");
const clearBtn = document.getElementById("clear-btn");
const undoBtn = document.getElementById("undo-btn");
const layoutSelect = document.getElementById("keyboard-layout");
const scanModeSelect = document.getElementById("scan-mode");
const predictionCheckbox = document.getElementById("prediction-enabled");
const scanSpeedSlider = document.getElementById("scan-speed");
const scanAnimationSelect = document.getElementById("scan-animation");
const predictionElements = document.querySelectorAll(".prediction");

let message = "";
let scanIndex = 0;
let scanning = false;
let scanMode = "linear";
let usePredictions = true;
let scanSpeed = 500;
let scanAnimation = "normal";
let ppm = null;
let context = null;
let currentRowIndex = -1; // For row-column scanning

// Keyboard layouts
const layouts = {
  abc: "ABCDEFGHIJKLMNOPQRSTUVWXYZ ".split(""),
  qwerty: "QWERTYUIOPASDFGHJKLZXCVBNM ".split(""),
  frequency: "ETAOINSHRDLUCMFWYPVBGKJQXZ ".split("") // Common English letter frequency
};

// Initialize the grid
function initGrid(layout = 'abc') {
  gridElement.innerHTML = ''; // Clear existing grid
  const letters = layouts[layout];
  const numRows = 6; // Define rows for row-column scanning
  const numCols = Math.ceil(letters.length / numRows);
  gridElement.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;

  letters.forEach((char) => {
    const letterElement = document.createElement("div");
    letterElement.classList.add("letter");
    letterElement.textContent = char;
    letterElement.dataset.char = char;
    gridElement.appendChild(letterElement);
  });
}

// Update Predictions
function getCurrentWord() {
  const words = message.split(' ');
  const currentWord = words[words.length - 1] || '';
  console.log('Getting current word:', currentWord);
  return currentWord;
}

function getTopPredictions(context, topN = 6) {
  // Get letter predictions from PPM
  const probs = ppm.getProbs(context);
  const letterPredictions = probs
    .map((p, index) => ({ symbol: window.vocab.symbols_[index], prob: p }))
    .filter((entry) => entry.prob > 0)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, topN)
    .map((entry) => entry.symbol);

  // Get word predictions
  const currentWord = getCurrentWord();
  const wordPredictions = window.vocab.getWordPredictions(currentWord);
  console.log('Predictions:', {
    currentWord,
    letterPredictions,
    wordPredictions,
    vocabWords: Array.from(window.vocab.words)
  });

  return {
    letters: letterPredictions,
    words: wordPredictions.slice(0, 4)
  };
}

function updatePredictions() {
  const predictions = getTopPredictions(context, 6);
  console.log('Updating predictions display:', predictions);
  
  // Update word predictions
  predictionElements.forEach((el, index) => {
    el.textContent = predictions.words[index] || '';
    el.classList.toggle('word-prediction', true);
  });
}

// Handle selection
function selectCharacter(char) {
  if (char) {
    message += char;
    window.vocab.updateCurrentWord(char); // Update word tracking
    ppm.addSymbolAndUpdate(context, window.vocab.symbols_.indexOf(char));
    messageElement.textContent = message;
    updatePredictions();
  }
}

// Handle word selection
function selectWord(word) {
  if (word) {
    // Remove the current incomplete word
    const words = message.split(' ');
    words.pop();
    message = words.join(' ');
    if (message.length > 0) message += ' ';
    
    // Add the selected word
    message += word + ' ';
    
    // Update PPM model with each character
    const chars = (word + ' ').split('');
    chars.forEach(char => {
      ppm.addSymbolAndUpdate(context, window.vocab.symbols_.indexOf(char));
    });
    
    messageElement.textContent = message;
    updatePredictions();
  }
}

// Event listeners for controls
layoutSelect.addEventListener("change", (e) => {
  initGrid(e.target.value);
  if (scanning) {
    stopScanning();
    startScanning();
  }
});

predictionCheckbox.addEventListener("change", (e) => {
  usePredictions = e.target.checked;
  if (scanning) {
    stopScanning();
    startScanning();
  }
});

scanModeSelect.addEventListener("change", (e) => {
  scanMode = e.target.value;
  if (scanning) {
    stopScanning();
    startScanning();
  }
});

scanSpeedSlider.addEventListener("input", (e) => {
  scanSpeed = parseInt(e.target.value, 10);
  document.getElementById('speed-value').textContent = scanSpeed + 'ms';
  if (scanning) {
    stopScanning();
    startScanning();
  }
});

// Function to stop scanning
function stopScanning() {
  scanning = false;
  scanIndex = 0;
  currentRowIndex = -1;
  const letterElements = Array.from(document.querySelectorAll(".letter"));
  letterElements.forEach((el) => el.classList.remove("scanning", "pulse", "row-highlight"));
  predictionElements.forEach((el) => el.classList.remove("scanning", "pulse"));
}

// Scanning
function startScanning() {
  stopScanning();
  scanning = true;
  const letterElements = Array.from(document.querySelectorAll(".letter"));
  let predictions = getTopPredictions(context, 6);
  let predictionScanningComplete = !usePredictions;

  const scanInterval = setInterval(() => {
    if (!scanning) {
      clearInterval(scanInterval);
      return;
    }

    // Clear previous highlights
    letterElements.forEach((el) => el.classList.remove("scanning", "pulse", "row-highlight"));
    predictionElements.forEach((el) => el.classList.remove("scanning", "pulse"));

    // First handle predictions if enabled
    if (usePredictions && !predictionScanningComplete) {
      // First scan word predictions
      if (scanIndex < predictionElements.length) {
        const el = predictionElements[scanIndex];
        if (el.textContent) {
          el.classList.add(scanAnimation === "pulse" ? "pulse" : "scanning");
        }
      } else {
        // Then scan predicted letters
        const letterIndex = scanIndex - predictionElements.length;
        if (letterIndex < predictions.letters.length) {
          const letter = predictions.letters[letterIndex];
          const letterEl = letterElements.find(el => el.dataset.char === letter);
          if (letterEl) {
            letterEl.classList.add(scanAnimation === "pulse" ? "pulse" : "scanning");
          }
        } else {
          predictionScanningComplete = true;
          scanIndex = 0;
          currentRowIndex = -1;
        }
      }
      scanIndex = (scanIndex + 1) % (predictionElements.length + predictions.letters.length);
    } else {
      // Regular scanning modes
      if (scanMode === "row-column") {
        const numCols = Math.ceil(letterElements.length / 6);
        const numRows = Math.ceil(letterElements.length / numCols);

        if (currentRowIndex === -1) {
          // Scanning rows
          const rowToHighlight = Math.floor(scanIndex / numCols);
          letterElements.forEach((el, index) => {
            const elementRow = Math.floor(index / numCols);
            if (elementRow === rowToHighlight) {
              el.classList.add("row-highlight");
            }
          });
          
          scanIndex = (scanIndex + 1) % numRows;
          if (scanIndex === 0) {
            currentRowIndex = 0;
          }
        } else {
          // Scanning columns within selected row
          const startIndex = currentRowIndex * numCols;
          const endIndex = Math.min(startIndex + numCols, letterElements.length);
          const columnIndex = scanIndex % numCols;
          
          if (startIndex + columnIndex < endIndex) {
            letterElements[startIndex + columnIndex].classList.add(
              scanAnimation === "pulse" ? "pulse" : "scanning"
            );
          }
          
          scanIndex = (scanIndex + 1) % numCols;
          if (scanIndex === 0) {
            currentRowIndex = -1; // Reset to row scanning
          }
        }
      } else {
        // Linear scanning
        if (scanIndex < letterElements.length) {
          letterElements[scanIndex].classList.add(
            scanAnimation === "pulse" ? "pulse" : "scanning"
          );
        }
        scanIndex = (scanIndex + 1) % letterElements.length;
      }
    }
  }, scanSpeed);
}

// Speech using Web Speech API
function speakMessage() {
  const utterance = new SpeechSynthesisUtterance(message);
  speechSynthesis.speak(utterance);
}

// Event listeners
speakBtn.addEventListener("click", speakMessage);
clearBtn.addEventListener("click", () => {
  message = "";
  messageElement.textContent = message;
  ppm.createContext(); // Reset context
  updatePredictions();
});
undoBtn.addEventListener("click", () => {
  message = message.slice(0, -1);
  messageElement.textContent = message;
  // Optionally rebuild context
});
gridElement.addEventListener("click", (e) => {
  if (e.target.classList.contains("letter")) {
    selectCharacter(e.target.dataset.char);
  }
});
scanAnimationSelect.addEventListener("change", (e) => {
  scanAnimation = e.target.value;
});

// Add click handlers for word predictions
predictionElements.forEach(el => {
  el.addEventListener('click', () => {
    if (el.textContent) {
      selectWord(el.textContent);
    }
  });
});

// Initialize app
async function initApp() {
  const model = await initializeModel();
  if (model) {
    ppm = model.ppm;
    context = model.context;
    initGrid(layoutSelect.value);
    updatePredictions();
    document.getElementById('speed-value').textContent = scanSpeed + 'ms';
    startScanning();
  } else {
    console.error('Failed to initialize model');
  }
}

// Start the app
initApp();