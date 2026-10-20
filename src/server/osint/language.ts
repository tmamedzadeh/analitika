const englishStopWords = new Set(
  "a an and are as at be been being but by can could did do does for from had has have he her hers him his how i if in into is it its may me might more most my no not of on or our she should so than that the their them then there these they this those to was we were what when where which who will with would you your".split(
    " ",
  ),
);
const azMarkers = new Set(["v\u0259", "bir", "il\u0259", "\u00fc\u00e7\u00fcn", "bu", "olan"]);

export function looksAzerbaijani(value: string): boolean {
  const words = value.toLocaleLowerCase("az").match(/[\p{L}]+/gu) ?? [];
  const letters = value.match(/\p{L}/gu) ?? [];
  if (!words.length || !letters.length) return false;

  const latinLetters = letters.filter((letter) => /\p{Script=Latin}/u.test(letter)).length;
  const latinRatio = latinLetters / letters.length;
  const englishRatio = words.filter((word) => englishStopWords.has(word)).length / words.length;
  const markerWords = words.filter(
    (word) => /[\u0259\u0131\u011f\u015f\u00e7\u00f6\u00fc]/u.test(word) || azMarkers.has(word),
  ).length;
  const markerRatio = markerWords / words.length;

  return latinRatio >= 0.9 && englishRatio < 0.12 && markerWords > 0 && markerRatio >= 0.04;
}
