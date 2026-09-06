const sentenceParts = (paragraph: string): string[] =>
  paragraph.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((part) => part.trim()) ?? [];

export const chunkSpokenText = (
  text: string,
  maximumCharacters = 1_200,
): string[] => {
  if (maximumCharacters < 100) {
    throw new Error('TTS chunk size must be at least 100 characters');
  }
  const units = text
    .split(/\n\s*\n/)
    .flatMap((paragraph) => sentenceParts(paragraph.trim()))
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  const push = (): void => {
    if (current) chunks.push(current);
    current = '';
  };
  units.forEach((unit) => {
    if (unit.length > maximumCharacters) {
      push();
      const words = unit.split(/\s+/);
      words.forEach((word) => {
        if (`${current} ${word}`.trim().length > maximumCharacters) push();
        current = `${current} ${word}`.trim();
      });
      push();
      return;
    }
    if (`${current} ${unit}`.trim().length > maximumCharacters) push();
    current = `${current} ${unit}`.trim();
  });
  push();
  return chunks;
};
