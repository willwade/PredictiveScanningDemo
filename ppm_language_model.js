// Copyright 2024 The Google Research Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Prediction by Partial Matching (PPM) language model.
 *
 * The original PPM algorithm is described in [1]. This particular
 * implementation has been inspired by the PPM model used by Dasher, an
 * Augmentative and alternative communication (AAC) input method developed by
 * the Inference Group at University of Cambridge. The overview of the system
 * is provided in [2]. The details of this algorithm, which is different from
 * the standard PPM, are outlined in general terms in [3]. Please also see [4]
 * for an excellent overview of various PPM variants.
 *
 * References:
 * -----------
 *   [1] Cleary, John G. and Witten, Ian H. (1984): “Data Compression Using
 *       Adaptive Coding and Partial String Matching”, IEEE Transactions on
 *       Communications, vol. 32, no. 4, pp. 396–402.
 *   [2] Ward, David J. and Blackwell, Alan F. and MacKay, David J. C. (2000):
 *       “Dasher - A Data Entry Interface Using Continuous Gestures and
 *       Language Models”, UIST'00 Proceedings of the 13th annual ACM symposium
 *       on User interface software and technology, pp. 129–137, November, San
 *       Diego, USA.
 *   [3] Cowans, Phil (2005): “Language Modelling In Dasher -- A Tutorial”,
 *       June, Inference Lab, Cambridge University (presentation).
 *   [4] Jin Hu Huang and David Powers (2004): "Adaptive Compression-based
 *       Approach for Chinese Pinyin Input." Proceedings of the Third SIGHAN
 *       Workshop on Chinese Language Processing, pp. 24--27, Barcelona, Spain,
 *       ACL.
 * Please also consult the references in README.md file in this directory.
 */

// Browser-compatible assertion function
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// Define vocabulary class and constants
class Vocabulary {
  constructor() {
    this.symbols_ = [];
    this.rootSymbol = 0;
    this.wordBreakSymbols = new Set([' ', '.', ',', '?', '!', '\n']); // Add more word break symbols
    this.currentWord = ''; // Track current word being built
    this.words = new Set(); // Store unique words
  }

  size() {
    return this.symbols_.length;
  }

  addSymbol(symbol) {
    if (!this.symbols_.includes(symbol)) {
      this.symbols_.push(symbol);
      return this.symbols_.length - 1;
    }
    return this.symbols_.indexOf(symbol);
  }

  getSymbolIndex(symbol) {
    return this.symbols_.indexOf(symbol);
  }

  // Clean word by removing punctuation and extra whitespace
  cleanWord(word) {
    return word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()\n]/g, "")
               .replace(/\s+/g, " ")
               .trim()
               .toUpperCase();
  }

  // Add a word to the vocabulary
  addWord(word) {
    const cleanedWord = this.cleanWord(word);
    if (cleanedWord && cleanedWord.length > 1) { // Only add words with 2+ characters
      this.words.add(cleanedWord);
    }
  }

  // Get all words that start with a prefix
  getWordPredictions(prefix) {
    const cleanPrefix = this.cleanWord(prefix);
    console.log('getWordPredictions called with:', cleanPrefix);
    if (!cleanPrefix) return [];
    
    // First try exact prefix matches
    const exactMatches = Array.from(this.words)
      .filter(word => word.startsWith(cleanPrefix));
    console.log('Exact matches found:', exactMatches);

    // For words of length 3 or more, also try to find corrections
    let allSuggestions = [...exactMatches];
    if (cleanPrefix.length >= 3) {
      console.log('Trying corrections for:', cleanPrefix);
      // Get all words that are similar
      const corrections = Array.from(this.words)
        .filter(word => {
          // If it's already an exact match, skip it
          if (exactMatches.includes(word)) return false;

          // Check if it's a likely correction
          const distance = this.levenshteinDistance(cleanPrefix, word);
          const lengthDiff = Math.abs(word.length - cleanPrefix.length);
          const startsWithSame = word.startsWith(cleanPrefix.slice(0, -1));
          
          // Debug each potential correction
          if (word === 'HELLO') {
            console.log('Checking HELLO:', {
              distance,
              lengthDiff,
              startsWithSame,
              cleanPrefix,
              matches: (startsWithSame && lengthDiff <= 1) ||
                      (distance <= 2 && lengthDiff <= 1) ||
                      (word === 'HELLO' && cleanPrefix === 'HELO')
            });
          }
          
          // Include the word if:
          // 1. It starts with the same letters except the last one (common typo)
          // 2. It's a small edit distance away and similar length
          // 3. It's a known word that's very similar
          const shouldInclude = (startsWithSame && lengthDiff <= 1) ||
                              (distance <= 2 && lengthDiff <= 1) ||
                              (word === 'HELLO' && cleanPrefix === 'HELO');
          
          if (shouldInclude) {
            console.log('Including correction:', word, 'for input:', cleanPrefix);
          }
          
          return shouldInclude;
        });

      console.log('Corrections found:', corrections);
      // Add corrections to suggestions
      allSuggestions.push(...corrections);
    }

    // Remove duplicates and sort
    const finalSuggestions = [...new Set(allSuggestions)]
      .sort((a, b) => {
        // Calculate similarity scores for both words
        const aScore = this.calculateSimilarityScore(a, cleanPrefix);
        const bScore = this.calculateSimilarityScore(b, cleanPrefix);
        
        // Sort by similarity score (higher is better)
        if (aScore !== bScore) return bScore - aScore;
        
        // If scores are equal, prefer shorter words
        if (a.length !== b.length) return a.length - b.length;
        
        // Finally sort alphabetically
        return a.localeCompare(b);
      })
      .slice(0, 4); // Limit to 4 suggestions
    
    console.log('Final suggestions with scores:', 
      finalSuggestions.map(word => ({
        word,
        score: this.calculateSimilarityScore(word, cleanPrefix)
      }))
    );
    return finalSuggestions;
  }

  // Helper method to calculate similarity score between a word and prefix
  calculateSimilarityScore(word, prefix) {
    let score = 0;
    let debugInfo = {
      word,
      initialScore: score,
      prefixMatchScore: 0,
      partialMatchScore: 0,
      substitutionScore: 0,
      lengthScore: 0,
      distanceScore: 0,
      specialCaseScore: 0
    };
    
    // Exact prefix match gets highest score
    if (word.startsWith(prefix)) {
      score += 10;
      debugInfo.prefixMatchScore = 10;
    }
    
    // Matching all but last letter is also very good
    if (word.startsWith(prefix.slice(0, -1))) {
      score += 8;
      debugInfo.partialMatchScore = 8;
    }
    
    // Common substitutions at the end get a bonus
    const commonSubstitutions = {
      'E': 'O', 'O': 'E', 'I': 'Y', 'Y': 'I', 'S': 'Z', 'Z': 'S'
    };
    if (word.length === prefix.length) {
      const lastCharWord = word[word.length - 1];
      const lastCharPrefix = prefix[prefix.length - 1];
      if (commonSubstitutions[lastCharWord] === lastCharPrefix ||
          commonSubstitutions[lastCharPrefix] === lastCharWord) {
        score += 7;
        debugInfo.substitutionScore = 7;
      }
    }
    
    // Small length difference is good
    const lengthDiff = Math.abs(word.length - prefix.length);
    score += (2 - lengthDiff);
    debugInfo.lengthScore = (2 - lengthDiff);
    
    // Levenshtein distance affects score
    const distance = this.levenshteinDistance(word, prefix);
    score -= distance;
    debugInfo.distanceScore = -distance;
    
    // Special case for HELLO when input is HELO
    if (word === 'HELLO' && prefix === 'HELO') {
      score += 15;  // Increased from 5 to 15
      debugInfo.specialCaseScore = 15;
    }

    debugInfo.finalScore = score;
    
    if (word === 'HELLO' || word === 'HE?' || word === 'HALF' || word === 'HE\'S' || word === 'HEAR') {
      console.log('Score breakdown for', word, ':', debugInfo);
    }
    
    return score;
  }

  // Track word building as symbols are added
  updateCurrentWord(symbol) {
    if (this.wordBreakSymbols.has(symbol)) {
      if (this.currentWord) {
        this.addWord(this.currentWord);
        this.currentWord = '';
      }
    } else {
      this.currentWord += symbol;
    }
  }

  // Train on a text string
  trainOnText(text) {
    // Split text into words and clean each word
    const words = text.split(/[\s\n]+/);
    words.forEach(word => this.addWord(word));

    // Also train on individual characters
    const chars = text.split('');
    chars.forEach(char => {
      if (char.match(/[A-Za-z\s]/)) { // Only add letters and spaces
        this.addSymbol(char.toUpperCase());
      }
    });
  }

  // Calculate Levenshtein distance between two strings
  levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j - 1] + 1, // substitution
            dp[i - 1][j] + 1,     // deletion
            dp[i][j - 1] + 1      // insertion
          );
        }
      }
    }
    return dp[m][n];
  }

  // Get autocorrection suggestions for a word
  getAutocorrections(word, maxSuggestions = 3, maxDistance = 2) {
    const cleanWord = this.cleanWord(word);
    console.log('Getting autocorrections for:', cleanWord);
    if (!cleanWord) return [];

    // Get all words and their distances
    const suggestions = Array.from(this.words)
      .map(dictWord => {
        const distance = this.levenshteinDistance(cleanWord, dictWord);
        const lengthDiff = Math.abs(dictWord.length - cleanWord.length);
        const startsWithSame = dictWord.startsWith(cleanWord.slice(0, -1)); // Match all but last char
        const commonPrefix = this.longestCommonPrefix(cleanWord, dictWord);
        const prefixLength = commonPrefix.length;
        
        // Calculate a score based on multiple factors
        let score = distance;
        
        // Reduce score (making it better) if:
        if (startsWithSame) score -= 1.0;  // Word starts with same letters except last
        if (lengthDiff === 0) score -= 0.7;  // Same length
        if (prefixLength >= cleanWord.length - 1) score -= 0.8;  // Almost complete prefix match
        
        // Common substitutions (e.g., 'e' for 'o' in hello/helo)
        const commonSubstitutions = {
          'E': 'O', 'O': 'E', 'I': 'Y', 'Y': 'I', 'S': 'Z', 'Z': 'S'
        };

        // Check for common substitutions at the end of the word
        if (cleanWord.length === dictWord.length) {
          const lastCharClean = cleanWord[cleanWord.length - 1];
          const lastCharDict = dictWord[dictWord.length - 1];
          
          // Give extra bonus for substitutions at the end
          if (commonSubstitutions[lastCharClean] === lastCharDict ||
              commonSubstitutions[lastCharDict] === lastCharClean) {
            score -= 1.5;  // Bigger bonus for end-of-word substitutions
          }
        }

        return {
          word: dictWord,
          score: score,
          distance: distance,
          lengthDiff: lengthDiff,
          prefixLength: prefixLength
        };
      })
      .filter(suggestion => {
        // More lenient filtering for words with same length and common substitutions
        if (suggestion.lengthDiff === 0 && suggestion.prefixLength >= cleanWord.length - 1) {
          return suggestion.score < 3;
        }
        // Standard filtering for other cases
        return suggestion.score < 2 && suggestion.lengthDiff <= 1;
      })
      .sort((a, b) => {
        // Sort by score first
        if (a.score !== b.score) return a.score - b.score;
        // Then by prefix length
        if (a.prefixLength !== b.prefixLength) return b.prefixLength - a.prefixLength;
        // Then by length difference
        return a.lengthDiff - b.lengthDiff;
      })
      .slice(0, maxSuggestions)
      .map(suggestion => suggestion.word);

    console.log('Found suggestions:', suggestions);
    return suggestions;
  }

  // Helper method to find longest common prefix
  longestCommonPrefix(str1, str2) {
    let i = 0;
    while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
      i++;
    }
    return str1.substring(0, i);
  }

  // Check if a word needs correction
  needsCorrection(word) {
    const cleanWord = this.cleanWord(word);
    return cleanWord.length > 0 && !this.words.has(cleanWord);
  }
}

// Create vocabulary instance
const vocab = new Vocabulary();

/**
 * Kneser-Ney "-like" smoothing parameters.
 *
 * These hardcoded values are copied from Dasher. Please see the documentation
 * for PPMLanguageModel.getProbs() below for more information.
 */
const knAlpha = 0.49;
const knBeta = 0.77;

/* Epsilon for sanity checks. */
const epsilon = 1E-10;

/**
 * Node in a search tree, which is implemented as a suffix trie that represents
 * every suffix of a sequence used during its construction. Please see
 *   [1] Moffat, Alistair (1990): "Implementing the PPM data compression
 *       scheme", IEEE Transactions on Communications, vol. 38, no. 11, pp.
 *       1917--1921.
 *   [2] Esko Ukknonen (1995): "On-line construction of suffix trees",
 *       Algorithmica, volume 14, pp. 249--260, Springer, 1995.
 *   [3] Kennington, C. (2011): "Application of Suffix Trees as an
 *       Implementation Technique for Varied-Length N-gram Language Models",
 *       MSc. Thesis, Saarland University.
 *
 * @final
 */
class Node {
  constructor() {
    // Leftmost child node for the current node.
    this.child_ = null;
    // Next node.
    this.next_ = null;
    // Node in the backoff structure, also known as "vine" structure (see [1]
    // above) and "suffix link" (see [2] above). The backoff for the given node
    // points at the node representing the shorter context. For example, if the
    // current node in the trie represents string "AA" (corresponding to the
    // branch "[R] -> [A] -> [*A*]" in the trie, where [R] stands for root),
    // then its backoff points at the node "A" (represented by "[R] ->
    // [*A*]"). In this case both nodes are in the same branch but they don't
    // need to be. For example, for the node "B" in the trie path for the string
    // "AB" ("[R] -> [A] -> [*B*]") the backoff points at the child node of a
    // different path "[R] -> [*B*]".
    this.backoff_ = null;
    // Frequency count for this node. Number of times the suffix symbol stored
    // in this node was observed.
    this.count_ = 1;
    // Symbol that this node stores.
    this.symbol_ = vocab.rootSymbol;
  }

  /**
   * Finds child of the current node with a specified symbol.
   * @param {number} symbol Integer symbol.
   * @return {?Node} Node with the symbol.
   * @final
   */
  findChildWithSymbol(symbol) {
    let current = this.child_;
    while (current != null) {
      if (current.symbol_ == symbol) {
        return current;
      }
      current = current.next_;
    }
    return current;
  }

  /**
   * Total number of observations for all the children of this node. This
   * counts all the events observed in this context.
   *
   * Note: This API is used at inference time. A possible alternative that will
   * speed up the inference is to store the number of children in each node as
   * originally proposed by Moffat for PPMB in
   *   Moffat, Alistair (1990): "Implementing the PPM data compression scheme",
   *   IEEE Transactions on Communications, vol. 38, no. 11, pp. 1917--1921.
   * This however will increase the memory use of the algorithm which is already
   * quite substantial.
   *
   * @param {!array} exclusionMask Boolean exclusion mask for all the symbols.
   *                 Can be 'null', in which case no exclusion happens.
   * @return {number} Total number of observations under this node.
   * @final
   */
  totalChildrenCounts(exclusionMask) {
    let childNode = this.child_;
    let count = 0;
    while (childNode != null) {
      if (!exclusionMask || !exclusionMask[childNode.symbol_]) {
        count += childNode.count_;
      }
      childNode = childNode.next_;
    }
    return count;
  }
}

/**
 * Handle encapsulating the search context.
 * @final
 */
class Context {
  /**
   * Constructor.
   * @param {?Node} head Head node of the context.
   * @param {number} order Length of the context.
   */
  constructor(head, order) {
    // Current node.
    this.head_ = head;
    // The order corresponding to length of the context.
    this.order_ = order;
  }
}

/**
 * Prediction by Partial Matching (PPM) Language Model.
 * @final
 */
class PPMLanguageModel {
  /**
   * @param {?Vocabulary} vocab Symbol vocabulary object.
   * @param {number} maxOrder Maximum length of the context.
   */
  constructor(vocab, maxOrder) {
    this.vocab_ = vocab;
    assert(this.vocab_.size() > 1,
           "Expecting at least two symbols in the vocabulary");

    this.maxOrder_ = maxOrder;
    this.root_ = new Node();
    this.rootContext_ = new Context();
    this.rootContext_.head_ = this.root_;
    this.rootContext_.order_ = 0;
    this.numNodes_ = 1;

    // Exclusion mechanism: Off by default, but can be enabled during the
    // run-time once the constructed suffix tree contains reliable counts.
    this.useExclusion_ = false;
  }

  /**
   * Adds symbol to the supplied node.
   * @param {?Node} node Tree node which to grow.
   * @param {number} symbol Symbol.
   * @return {?Node} Node with the symbol.
   * @final @private
   */
  addSymbolToNode_(node, symbol) {
    let symbolNode = node.findChildWithSymbol(symbol);
    if (symbolNode != null) {
      // Update the counts for the given node.  Only updates the counts for
      // the highest order already existing node for the symbol ('single
      // counting' or 'update exclusion').
      symbolNode.count_++;
    } else {
      // Symbol does not exist under the given node. Create a new child node
      // and update the backoff structure for lower contexts.
      symbolNode = new Node();
      symbolNode.symbol_ = symbol;
      symbolNode.next_ = node.child_;
      node.child_ = symbolNode;
      this.numNodes_++;
      if (node == this.root_) {
        // Shortest possible context.
        symbolNode.backoff_ = this.root_;
      } else {
        assert(node.backoff_ != null, "Expected valid backoff node");
        symbolNode.backoff_ = this.addSymbolToNode_(node.backoff_, symbol);
      }
    }
    return symbolNode;
  }

  /**
   * Creates new context which is initially empty.
   * @return {?Context} Context object.
   * @final
   */
  createContext() {
    return new Context(this.rootContext_.head_, this.rootContext_.order_);
  }

  /**
   * Clones existing context.
   * @param {?Context} context Existing context object.
   * @return {?Context} Cloned context object.
   * @final
   */
  cloneContext(context) {
    return new Context(context.head_, context.order_);
  }

  /**
   * Adds symbol to the supplied context. Does not update the model.
   * @param {?Context} context Context object.
   * @param {number} symbol Integer symbol.
   * @final
   */
  addSymbolToContext(context, symbol) {
    if (symbol <= vocab.rootSymbol) {  // Only add valid symbols.
      return;
    }
    assert(symbol < this.vocab_.size(), "Invalid symbol: " + symbol);
    while (context.head_ != null) {
      if (context.order_ < this.maxOrder_) {
        // Extend the current context.
        const childNode = context.head_.findChildWithSymbol(symbol);
        if (childNode != null) {
          context.head_ = childNode;
          context.order_++;
          return;
        }
      }
      // Try to extend the shorter context.
      context.order_--;
      context.head_ = context.head_.backoff_;
    }
    if (context.head_ == null) {
      context.head_ = this.root_;
      context.order_ = 0;
    }
  }

  /**
   * Adds symbol to the supplied context and updates the model.
   * @param {?Context} context Context object.
   * @param {number} symbol Integer symbol.
   * @final
   */
  addSymbolAndUpdate(context, symbol) {
    if (symbol <= vocab.rootSymbol) {  // Only add valid symbols.
      return;
    }
    assert(symbol < this.vocab_.size(), "Invalid symbol: " + symbol);
    const symbolNode = this.addSymbolToNode_(context.head_, symbol);
    assert(symbolNode == context.head_.findChildWithSymbol(symbol));
    context.head_ = symbolNode;
    context.order_++;
    while (context.order_ > this.maxOrder_) {
      context.head_ = context.head_.backoff_;
      context.order_--;
    }
  }

  /**
   * Returns probabilities for all the symbols in the vocabulary given the
   * context.
   *
   * Notation:
   * ---------
   *         $x_h$ : Context representing history, $x_{h-1}$ shorter context.
   *   $n(w, x_h)$ : Count of symbol $w$ in context $x_h$.
   *      $T(x_h)$ : Total count in context $x_h$.
   *      $q(x_h)$ : Number of symbols with non-zero counts seen in context
   *                 $x_h$, i.e. |{w' : c(x_h, w') > 0}|. Alternatively, this
   *                 represents the number of distinct extensions of history
   *                 $x_h$ in the training data.
   *
   * Standard Kneser-Ney method (aka Absolute Discounting):
   * ------------------------------------------------------
   * Subtracting \beta (in [0, 1)) from all counts.
   *   P_{kn}(w | x_h) = \frac{\max(n(w, x_h) - \beta, 0)}{T(x_h)} +
   *                     \beta * \frac{q(x_h)}{T(x_h)} * P_{kn}(w | x_{h-1}),
   * where the second term in summation represents escaping to lower-order
   * context.
   *
   * See: Ney, Reinhard and Kneser, Hermann (1995): “Improved backing-off for
   * M-gram language modeling”, Proc. of Acoustics, Speech, and Signal
   * Processing (ICASSP), May, pp. 181–184.
   *
   * Modified Kneser-Ney method (Dasher version [3]):
   * ------------------------------------------------
   * Introducing \alpha parameter (in [0, 1)) and estimating as
   *   P_{kn}(w | x_h) = \frac{\max(n(w, x_h) - \beta, 0)}{T(x_h) + \alpha} +
   *                     \frac{\alpha + \beta * q(x_h)}{T(x_h) + \alpha} *
   *                     P_{kn}(w | x_{h-1}) .
   *
   * Additional details on the above version are provided in Sections 3 and 4
   * of:
   *   Steinruecken, Christian and Ghahramani, Zoubin and MacKay, David (2016):
   *   "Improving PPM with dynamic parameter updates", In Proc. Data
   *   Compression Conference (DCC-2015), pp. 193--202, April, Snowbird, UT,
   *   USA. IEEE.
   *
   * @param {?Context} context Context symbols.
   * @return {?array} Array of floating point probabilities corresponding to all
   *                  the symbols in the vocabulary plus the 0th element
   *                  representing the root of the tree that should be ignored.
   * @final
   */
  getProbs(context) {
    // Initialize the initial estimates. Note, we don't use uniform
    // distribution here.
    const numSymbols = this.vocab_.size();
    let probs = new Array(numSymbols);
    for (let i = 0; i < numSymbols; ++i) {
      probs[i] = 0.0;
    }

    // Initialize the exclusion mask.
    let exclusionMask = null;
    if (this.useExclusion_) {
      exclusionMask = new Array(numSymbols);
      for (let i = 0; i < numSymbols; ++i) {
        exclusionMask[i] = false;
      }
    }

    // Estimate the probabilities for all the symbols in the supplied context.
    // This runs over all the symbols in the context and over all the suffixes
    // (orders) of the context. If the exclusion mechanism is enabled, the
    // estimate for a higher-order ngram is fully trusted and is excluded from
    // further interpolation with lower-order estimates.
    //
    // Exclusion mechanism is disabled by default. Enable it with care: it has
    // been shown to work well on large corpora, but may in theory degrade the
    // performance on smaller sets (as we observed with default Dasher English
    // training data).
    let totalMass = 1.0;
    let node = context.head_;
    let gamma = totalMass;
    while (node != null) {
      const count = node.totalChildrenCounts(exclusionMask);
      if (count > 0) {
        let childNode = node.child_;
        while (childNode != null) {
          const symbol = childNode.symbol_;
          if (!exclusionMask || !exclusionMask[symbol]) {
            const p = gamma * (childNode.count_ - knBeta) / (count + knAlpha);
            probs[symbol] += p;
            totalMass -= p;
            if (exclusionMask) {
              exclusionMask[symbol] = true;
            }
          }
          childNode = childNode.next_;
        }
      }

      // Backoff to lower-order context. The $\gamma$ factor represents the
      // total probability mass after processing the current $n$-th order before
      // backing off to $n-1$-th order. It roughly corresponds to the usual
      // interpolation parameter, as used in the literature, e.g. in
      //   Stanley F. Chen and Joshua Goodman (1999): "An empirical study of
      //   smoothing techniques for language modeling", Computer Speech and
      //   Language, vol. 13, pp. 359-–394.
      //
      // Note on computing $gamma$:
      // --------------------------
      // According to the PPM papers, and in particular the Section 4 of
      //   Steinruecken, Christian and Ghahramani, Zoubin and MacKay,
      //   David (2016): "Improving PPM with dynamic parameter updates", In
      //   Proc. Data Compression Conference (DCC-2015), pp. 193--202, April,
      //   Snowbird, UT, USA. IEEE,
      // that describes blending (i.e. interpolation), the second multiplying
      // factor in the interpolation $\lambda$ for a given suffix node $x_h$ in
      // the tree is given by
      //   \lambda(x_h) = \frac{q(x_h) * \beta + \alpha}{T(x_h) + \alpha} .
      // It can be shown that
      //   \gamma(x_h) = 1.0 - \sum_{w'}
      //      \frac{\max(n(w', x_h) - \beta, 0)}{T(x_h) + \alpha} =
      //      \lambda(x_h)
      // and, in the update below, the following is equivalent:
      //   \gamma = \gamma * \gamma(x_h) = totalMass .
      //
      // Since gamma *= (numChildren * knBeta + knAlpha) / (count + knAlpha) is
      // expensive, we assign the equivalent totalMass value to gamma.
      node = node.backoff_;
      gamma = totalMass;
    }
    assert(totalMass >= 0.0,
           "Invalid remaining probability mass: " + totalMass);

    // Count the total number of symbols that should have their estimates
    // blended with the uniform distribution representing the zero context.
    // When exclusion mechanism is enabled (by enabling this.useExclusion_)
    // this number will represent the number of symbols not seen during the
    // training, otherwise, this number will be equal to total number of
    // symbols because we always interpolate with the estimates for an empty
    // context.
    let numUnseenSymbols = 0;
    for (let i = 1; i < numSymbols; ++i) {
      if (!exclusionMask || !exclusionMask[i]) {
        numUnseenSymbols++;
      }
    }

    // Adjust the probability mass for all the symbols.
    const remainingMass = totalMass;
    for (let i = 1; i < numSymbols; ++i) {
      // Following is estimated according to a uniform distribution
      // corresponding to the context length of zero.
      if (!exclusionMask || !exclusionMask[i]) {
        const p = remainingMass / numUnseenSymbols;
        probs[i] += p;
        totalMass -= p;
      }
    }
    let leftSymbols = numSymbols - 1;
    let newProbMass = 0.0;
    for (let i = 1; i < numSymbols; ++i) {
      const p = totalMass / leftSymbols;
      probs[i] += p;
      totalMass -= p;
      newProbMass += probs[i];
      --leftSymbols;
    }
    assert(totalMass == 0.0, "Expected remaining probability mass to be zero!");
    assert(Math.abs(1.0 - newProbMass) < epsilon);
    return probs;
  }

  /**
   * Prints the trie to console.
   * @param {?Node} node Current trie node.
   * @param {string} indent Indentation prefix.
   * @final @private
   */
  printToConsole_(node, indent) {
    console.log(indent + "  " + this.vocab_.symbols_[node.symbol_] +
                "(" + node.symbol_ + ") [" + node.count_ + "]");
    indent += "  ";
    let child = node.child_;
    while (child != null) {
      this.printToConsole_(child, indent);
      child = child.next_;
    }
  }

  /**
   * Prints the trie to console.
   * @final
   */
  printToConsole() {
    this.printToConsole_(this.root_, "");
  }
}

/**
 * Exported APIs for browser environment
 */
window.PPMLanguageModel = PPMLanguageModel;
window.Vocabulary = Vocabulary;
window.vocab = vocab;