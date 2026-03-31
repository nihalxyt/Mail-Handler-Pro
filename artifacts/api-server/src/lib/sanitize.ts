export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeSearchQuery(input: string): string {
  return escapeRegex(input.trim()).substring(0, 200);
}

export function isValidDbKey(key: string): key is "bot1" | "bot2" {
  return key === "bot1" || key === "bot2";
}
