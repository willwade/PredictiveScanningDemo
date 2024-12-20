// Initialize vocabulary and PPM model
const maxOrder = 3; // Max context length for predictions

// Initialize the model and load training data
async function initializeModel() {
  try {
    const response = await fetch('training_data.txt');
    const trainingText = await response.text();
    console.log('Training text loaded:', trainingText.slice(0, 100) + '...');
    
    // Add common English words to vocabulary
    const commonWords = [
      'THE', 'BE', 'TO', 'OF', 'AND', 'A', 'IN', 'THAT', 'HAVE', 'I',
      'IT', 'FOR', 'NOT', 'ON', 'WITH', 'HE', 'AS', 'YOU', 'DO', 'AT',
      'THIS', 'BUT', 'HIS', 'BY', 'FROM', 'THEY', 'WE', 'SAY', 'HER', 'SHE',
      'OR', 'AN', 'WILL', 'MY', 'ONE', 'ALL', 'WOULD', 'THERE', 'THEIR', 'WHAT',
      'SO', 'UP', 'OUT', 'IF', 'ABOUT', 'WHO', 'GET', 'WHICH', 'GO', 'ME',
      'HELLO', 'WORLD', 'YES', 'NO', 'PLEASE', 'THANK', 'YOU', 'GOOD', 'BAD',
      'HELP', 'WANT', 'NEED', 'CAN', 'SOME', 'TIME', 'NOW', 'LIKE', 'JUST', 'KNOW'
    ];
    
    // Train vocabulary with common words first
    commonWords.forEach(word => window.vocab.addWord(word));
    
    // Then train on the training text
    window.vocab.trainOnText(trainingText);
    
    console.log('Vocabulary after training:', 
      'Symbols:', window.vocab.symbols_,
      'Words:', Array.from(window.vocab.words).slice(0, 20), // Show first 20 words
      'Total words:', window.vocab.words.size);
    
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
const toggleControlsBtn = document.getElementById('toggle-controls');
const controlsDiv = document.getElementById('controls');
const scanStartBtn = document.getElementById('scan-start-btn');

// Remove scan button styles
const style = document.createElement('style');
style.textContent = `
  #controls {
    padding: 8px 16px;
  }
`;
document.head.appendChild(style);

// State variables
let message = "";
let scanIndex = 0;
let scanning = false;
let scanMode = "linear";
let usePredictions = true;
let scanSpeed = 500;
let scanAnimation = "highlight";
let ppm = null;
let context = null;
let currentRowIndex = -1;
let scanInterval = null;
let currentHighlightedElement = null;
let currentWord = '';
let autocorrectEnabled = true;

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
  
  // Convert probabilities to sorted array of {symbol, prob} pairs
  const predictions = probs
    .map((prob, index) => ({ symbol: window.vocab.symbols_[index], prob }))
    .filter(entry => entry.prob > 0 && entry.symbol.match(/[A-Z ]/)) // Only include letters and space
    .sort((a, b) => b.prob - a.prob);

  // Get top N letter predictions
  const letterPredictions = predictions
    .slice(0, topN)
    .map(entry => entry.symbol);

  // Get word predictions
  const currentWord = getCurrentWord();
  const wordPredictions = window.vocab.getWordPredictions(currentWord);

  return {
    letters: letterPredictions,
    words: wordPredictions.slice(0, 4)
  };
}

function updatePredictions() {
  const predictions = getTopPredictions(context, 6);
  console.log('Updating predictions display:', predictions);
  
  // Get current word and corrections
  const currentWord = getCurrentWord();
  let corrections = [];
  if (currentWord.length >= 3 && autocorrectEnabled) {
    corrections = window.vocab.getAutocorrections(currentWord);
    console.log('Current corrections:', corrections);
  }
  
  // Update word predictions
  const predictionsContainer = document.getElementById('predictions');
  const predictionElements = predictionsContainer.querySelectorAll('.prediction');
  predictions.words.forEach((word, index) => {
    if (predictionElements[index]) {
      predictionElements[index].textContent = word;
      predictionElements[index].style.display = 'block';
      predictionElements[index].onclick = () => selectWord(word);
    }
  });
  
  // Hide unused prediction elements
  for (let i = predictions.words.length; i < predictionElements.length; i++) {
    predictionElements[i].style.display = 'none';
  }
  
  // Update corrections - get top 2 corrections that aren't already in predictions
  const correctionsContainer = document.getElementById('corrections');
  if (correctionsContainer) {
    const correctionElements = correctionsContainer.querySelectorAll('.correction');
    
    // Filter out corrections that are already in predictions
    const filteredCorrections = corrections
      .filter(word => !predictions.words.includes(word))
      .slice(0, 2); // Only take top 2
    
    console.log('Filtered corrections to display:', filteredCorrections);
    
    // Update correction elements
    filteredCorrections.forEach((word, index) => {
      if (correctionElements[index]) {
        correctionElements[index].textContent = word;
        correctionElements[index].style.display = 'block';
        correctionElements[index].onclick = () => selectWord(word);
      }
    });
    
    // Hide unused correction elements
    for (let i = filteredCorrections.length; i < correctionElements.length; i++) {
      correctionElements[i].style.display = 'none';
    }

    // Show/hide corrections container based on whether we have corrections
    correctionsContainer.style.display = filteredCorrections.length > 0 ? 'flex' : 'none';
  }
}

// Add this function to update probability highlighting
function updateProbabilityHighlights() {
  const letterElements = Array.from(document.querySelectorAll(".letter"));
  // Clear existing probability classes
  letterElements.forEach(el => {
    for (let i = 0; i < 6; i++) {
      el.classList.remove(`prob-${i}`);
    }
  });

  // Get predictions
  const predictions = getTopPredictions(context, 6);
  
  // Apply new probability classes
  predictions.letters.forEach((letter, index) => {
    const letterEl = letterElements.find(el => el.dataset.char === letter);
    if (letterEl) {
      letterEl.classList.add(`prob-${index}`);
    }
  });
}

// Handle selection
function selectCharacter(char) {
  if (char) {
    if (char === ' ') {
      // When space is selected, add the current word to vocabulary
      if (currentWord) {
        vocab.addWord(currentWord);
        currentWord = '';
      }
    } else {
      currentWord = (currentWord || '') + char;
    }

    message += char;
    messageElement.textContent = message;
    vocab.updateCurrentWord(char);
    ppm.addSymbolAndUpdate(context, vocab.getSymbolIndex(char));
    
    // Update UI
    updatePredictions();
    updateProbabilityHighlights();
    updateSuggestions();
    
    // Restart scanning with new predictions
    if (scanning) {
      stopScanning();
      startScanning();
    }
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
    messageElement.textContent = message;
    
    // Update PPM model with each character
    const chars = (word + ' ').split('');
    chars.forEach(char => {
      ppm.addSymbolAndUpdate(context, vocab.getSymbolIndex(char));
    });

    // Reset current word and update UI
    currentWord = '';
    updatePredictions();
    updateProbabilityHighlights();
    updateSuggestions();
  }
}

// Event listeners for controls
layoutSelect.addEventListener("change", (e) => {
  initGrid(e.target.value);
  updateProbabilityHighlights();
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
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  scanning = false;
  scanIndex = 0;
  currentRowIndex = -1;
  
  // Clear all highlights
  const letterElements = Array.from(document.querySelectorAll(".letter"));
  letterElements.forEach((el) => el.classList.remove("highlight", "pulse", "line", "row-highlight"));
  
  // Clear prediction highlights
  document.querySelectorAll('.prediction, .correction').forEach((el) => {
    el.classList.remove("highlight", "pulse", "line");
  });
}

// Scanning
function startScanning() {
  console.log('Starting scanning...');
  if (scanning) {
    stopScanning();
    return;
  }

  stopScanning();
  scanning = true;

  document.documentElement.style.setProperty('--scan-speed', `${scanSpeed}ms`);

  const letterElements = Array.from(document.querySelectorAll(".letter"));
  let predictions = getTopPredictions(context, 6);
  let firstLoopComplete = false;
  let predictiveScanningDone = !usePredictions;
  let predictedLetterElements = [];
  let loopCount = 0;

  // If using predictions, prepare the predicted letters order
  if (usePredictions) {
    // Create a map of predicted letters for quick lookup
    const predictionMap = new Map(
      predictions.letters.map((letter, index) => [letter, index])
    );
    
    // Sort letter elements by prediction probability
    predictedLetterElements = letterElements
      .filter(el => predictionMap.has(el.dataset.char))
      .sort((a, b) => 
        predictionMap.get(a.dataset.char) - predictionMap.get(b.dataset.char)
      );

    console.log('Predicted letters order:', 
      predictedLetterElements.map(el => el.dataset.char).join(', '));
  }

  scanIndex = 0;
  currentRowIndex = -1;

  scanInterval = setInterval(() => {
    if (!scanning) {
      clearInterval(scanInterval);
      return;
    }

    // Clear previous highlights
    letterElements.forEach((el) => {
      el.classList.remove("highlight", "pulse", "line", "row-highlight");
      if (scanAnimation === 'line') {
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = null;
      }
    });

    // First loop with predictions if enabled
    if (usePredictions && !predictiveScanningDone) {
      if (scanIndex < predictedLetterElements.length) {
        const letterEl = predictedLetterElements[scanIndex];
        letterEl.classList.add(scanAnimation);
        scanIndex++;
      } else {
        predictiveScanningDone = true;
        scanIndex = 0;
        currentRowIndex = -1;
      }
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
            if (!firstLoopComplete) {
              firstLoopComplete = true;
              predictiveScanningDone = !usePredictions;
            }
            currentRowIndex = 0;
          }
        } else {
          // Scanning columns within selected row
          const startIndex = currentRowIndex * numCols;
          const endIndex = Math.min(startIndex + numCols, letterElements.length);
          const columnIndex = scanIndex % numCols;
          
          if (startIndex + columnIndex < endIndex) {
            letterElements[startIndex + columnIndex].classList.add(scanAnimation);
          }
          
          scanIndex = (scanIndex + 1) % numCols;
          if (scanIndex === 0) {
            currentRowIndex = -1; // Reset to row scanning
          }
        }
      } else {
        // Linear scanning
        if (scanIndex < letterElements.length) {
          letterElements[scanIndex].classList.add(scanAnimation);
        }
        scanIndex = (scanIndex + 1) % letterElements.length;
        if (scanIndex === 0) {
          if (!firstLoopComplete) {
            firstLoopComplete = true;
            predictiveScanningDone = !usePredictions;
          }
          loopCount++;
          if (loopCount >= 3) {
            stopScanning();
            return;
          }
        }
      }
    }
  }, scanSpeed);
}

// Speech using Web Speech API
function speakMessage() {
  const utterance = new SpeechSynthesisUtterance(message);
  speechSynthesis.speak(utterance);
}

// Add this function to handle selection during scanning
function handleScanSelection() {
  if (!scanning) return;
  
  const letterElements = Array.from(document.querySelectorAll(".letter"));
  const highlightedLetter = letterElements.find(el => 
    el.classList.contains("highlight") || 
    el.classList.contains("pulse") || 
    el.classList.contains("line") ||
    el.classList.contains("row-highlight")
  );

  if (highlightedLetter) {
    if (scanMode === "row-column") {
      if (currentRowIndex === -1) {
        // If we're scanning rows, select the row
        currentRowIndex = Math.floor([...letterElements].indexOf(highlightedLetter) / Math.ceil(letterElements.length / 6));
        scanIndex = 0;
      } else {
        // If we're scanning within a row, select the letter
        selectCharacter(highlightedLetter.dataset.char);
        currentRowIndex = -1;
        scanIndex = 0;
      }
    } else {
      // For linear scanning, just select the letter
      selectCharacter(highlightedLetter.dataset.char);
      scanIndex = 0;
    }
  }
}

function updateSuggestions() {
  console.log('Updating suggestions for word:', currentWord);
  if (!autocorrectEnabled || !currentWord) {
    console.log('Autocorrect disabled or no current word');
    return;
  }

  // First try word predictions
  const predictions = window.vocab.getWordPredictions(currentWord);
  console.log('Word predictions:', predictions);

  // Always get autocorrections for words 3 or more characters
  let suggestions = [];
  if (currentWord.length >= 3) {
    const corrections = window.vocab.getAutocorrections(currentWord);
    console.log('Autocorrection suggestions:', corrections);
    suggestions = corrections;
    
    // Add predictions only if they're not already in corrections
    predictions.forEach(word => {
      if (!suggestions.includes(word)) {
        suggestions.push(word);
      }
    });
  } else {
    suggestions = predictions;
  }
}

function applySuggestion(word) {
    // Remove the current incomplete word
    const words = message.split(' ');
    words.pop();
    message = words.join(' ');
    if (message.length > 0) message += ' ';
    
    // Add the suggested word
    message += word + ' ';
    messageElement.textContent = message;
    
    // Update PPM model with each character
    const chars = (word + ' ').split('');
    chars.forEach(char => {
      ppm.addSymbolAndUpdate(context, vocab.getSymbolIndex(char));
    });

    // Reset current word and update UI
    currentWord = '';
    updatePredictions();
    updateProbabilityHighlights();
    updateSuggestions();
}

function handleInput(letter) {
    if (!message) return;

    if (vocabulary.wordBreakSymbols.has(letter)) {
        currentWord = '';
    } else {
        currentWord = (currentWord || '') + letter;
    }

    message.textContent += letter;
    updateSuggestions();
    updatePredictions();
}

// Update the clear function
function clearMessage() {
    message = "";
    messageElement.textContent = message;
    currentWord = '';
    context = ppm.createContext(); // Reset context
    updatePredictions();
    updateProbabilityHighlights();
    updateSuggestions();
}

// Update the undo function
function undoLastCharacter() {
    if (!message) return;
    
    message = message.slice(0, -1);
    messageElement.textContent = message;
    
    // Update current word
    if (currentWord) {
      currentWord = currentWord.slice(0, -1);
    }
    
    // If we removed a space, get the last word
    if (message.length > 0 && message[message.length - 1] !== ' ') {
      const words = message.split(' ');
      currentWord = words[words.length - 1];
    }
    
    updatePredictions();
    updateProbabilityHighlights();
    updateSuggestions();
}

// Initialize app
async function initApp() {
  const model = await initializeModel();
  if (model) {
    ppm = model.ppm;
    context = model.context;
    initGrid(layoutSelect.value);
    updatePredictions();
    updateProbabilityHighlights();
    document.getElementById('speed-value').textContent = scanSpeed + 'ms';

    // Set up all event listeners
    speakBtn.addEventListener("click", speakMessage);
    clearBtn.addEventListener("click", clearMessage);
    undoBtn.addEventListener("click", undoLastCharacter);
    
    // Add autocorrect toggle listener if element exists
    const autocorrectToggle = document.getElementById('autocorrect-enabled');
    if (autocorrectToggle) {
      autocorrectToggle.addEventListener('change', (e) => {
        autocorrectEnabled = e.target.checked;
        updatePredictions(); // This will also update corrections
      });
    }

    gridElement.addEventListener("click", (e) => {
      if (e.target.classList.contains("letter")) {
        selectCharacter(e.target.dataset.char);
      }
    });
    
    scanAnimationSelect.addEventListener("change", (e) => {
      scanAnimation = e.target.value;
    });

    // Add keyboard event listener
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault(); // Prevent page scrolling
        if (scanning) {
          handleScanSelection();
        } else {
          startScanning();
        }
      } else if (e.code === 'Escape') {
        stopScanning();
      }
    });

    // Add toggle controls event listener
    toggleControlsBtn.addEventListener('click', () => {
      controlsDiv.classList.toggle('hidden');
      localStorage.setItem('controlsHidden', controlsDiv.classList.contains('hidden'));
    });

    // Load controls visibility preference
    if (localStorage.getItem('controlsHidden') === 'true') {
      controlsDiv.classList.add('hidden');
    }

    // Add control change listeners
    layoutSelect.addEventListener("change", (e) => {
      initGrid(e.target.value);
      updateProbabilityHighlights();
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

    // Add scan start button listener
    if (scanStartBtn) {
      scanStartBtn.addEventListener('click', () => {
        if (scanning) {
          stopScanning();
        } else {
          startScanning();
        }
      });
    }

    // Start scanning automatically
    startScanning();
  } else {
    console.error('Failed to initialize model');
  }
}

// Add styles for suggestions
const suggestionStyles = document.createElement('style');
suggestionStyles.textContent = `
    .suggestions {
        margin: 10px 0;
        min-height: 30px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: center;
    }
    .suggestion {
        display: inline-block;
        padding: 5px 10px;
        background-color: #e0e0e0;
        border-radius: 5px;
        cursor: pointer;
        font-size: 16px;
        transition: background-color 0.2s;
    }
    .suggestion:hover {
        background-color: #d0d0d0;
    }
`;
document.head.appendChild(suggestionStyles);

// Start the app
initApp();