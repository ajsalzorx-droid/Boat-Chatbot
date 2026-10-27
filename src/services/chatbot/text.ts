import type { Language } from "./types";

/** Text normalisation and tokenisation for English and Arabic keyword matching. */

const ARABIC_SCRIPT = /[؀-ۿ]/;
const ARABIC_DIACRITICS = /[ً-ٰٟـ]/g;

export function detectLanguage(text: string): Language {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return arabic > 0 && arabic >= latin ? "ar" : "en";
}

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS: ReadonlySet<string> = new Set([
  // English
  "a", "an", "the", "is", "are", "am", "was", "were", "be", "do", "does", "did", "i", "me", "my", "you", "your",
  "we", "our", "us", "it", "its", "to", "of", "in", "on", "at", "for", "and", "or", "with", "can", "could",
  "please", "pls", "plz", "what", "whats", "how", "much", "many", "any", "have", "has", "this", "that", "there",
  "will", "would", "about", "from", "get", "want", "need", "know", "tell", "hi", "hello", "hey", "u", "ur",
  // Arabic
  "في", "من", "على", "الى", "عن", "هل", "ما", "ماذا", "كم", "هذا", "هذه", "انا", "انت", "لو", "مع", "او", "و",
]);

function stemArabic(token: string): string {
  return token.length > 4 && token.startsWith("ال") ? token.slice(2) : token;
}

/** Content tokens: normalised, stopwords removed, Arabic definite article stripped. */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map((token) => (ARABIC_SCRIPT.test(token) ? stemArabic(token) : token));
}

/** Two tokens match when equal, or when one is a prefix of the other (deliver / delivery). */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

export function countMatches(messageTokens: readonly string[], targetTokens: readonly string[]): number {
  let matches = 0;
  for (const token of new Set(messageTokens)) {
    if (targetTokens.some((target) => tokensMatch(token, target))) matches += 1;
  }
  return matches;
}

export function containsPhrase(text: string, phrases: readonly string[]): boolean {
  const normalised = ` ${normalize(text)} `;
  return phrases.some((phrase) => normalised.includes(` ${normalize(phrase)} `));
}

/** Truncates at a sentence or word boundary, never mid-word. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength - 1);
  const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "), slice.lastIndexOf("\n"));
  if (sentenceEnd > maxLength * 0.5) return slice.slice(0, sentenceEnd + 1).trim();
  const wordEnd = slice.lastIndexOf(" ");
  return `${(wordEnd > 0 ? slice.slice(0, wordEnd) : slice).trim()}…`;
}
