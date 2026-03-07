/** Parse release-drafter markdown sections into structured blocks. */
export function parseBody(body: string): { heading: string; items: string[] }[] {
  const sections: { heading: string; items: string[] }[] = [];
  let current: { heading: string; items: string[] } | null = null;

  for (const line of body.split("\n")) {
    const headingMatch = line.match(/^###\s+(.+)/);
    if (headingMatch) {
      current = { heading: headingMatch[1].trim(), items: [] };
      sections.push(current);
      continue;
    }
    const itemMatch = line.match(/^\s*[-*]\s+(.+)/);
    if (itemMatch && current) {
      current.items.push(itemMatch[1].trim());
    }
  }

  return sections;
}

export function badgeVariant(
  heading: string,
): "default" | "secondary" | "destructive" | "outline" {
  const lower = heading.toLowerCase();
  if (lower.includes("breaking")) return "destructive";
  if (lower.includes("feature")) return "default";
  if (lower.includes("security")) return "outline";
  return "secondary";
}
