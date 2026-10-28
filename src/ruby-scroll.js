export function isNearScrollEnd(element, threshold = 72) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

export function scrollToLatest(element, behavior = "auto") {
  if (!element) return false;
  const top = element.scrollHeight;
  if (typeof element.scrollTo === "function") element.scrollTo({ top, behavior });
  else element.scrollTop = top;
  return true;
}
