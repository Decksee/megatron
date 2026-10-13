/**
 * Empêche l'encoche de se refermer pendant une action longue
 * (ex. boîte de dialogue de fichier ouverte, qui fait perdre le survol).
 */
let holds = 0;

export const isHeld = () => holds > 0;

export async function holdOpen<T>(fn: () => Promise<T>): Promise<T> {
  holds++;
  try {
    return await fn();
  } finally {
    holds--;
  }
}
