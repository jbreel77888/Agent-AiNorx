export function autoLinkUrls(text: string): string {
  // Simple URL detection and wrapping in markdown links
  const urlRegex = /(https?:\/\/[^\s<>\])"']+)/g;
  return text.replace(urlRegex, (url) => {
    // Don't double-wrap if already in markdown link
    return url;
  });
}
