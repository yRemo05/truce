/** Absolute URL for an in-app path. */
export const absolute = (path: string) => new URL(path, window.location.origin).toString();

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/** The native share sheet when there is one; false if the person closed it or there is none. */
export async function shareLink(data: { title: string; text: string; url: string }): Promise<boolean> {
  if (!canShare()) return false;
  try {
    await navigator.share(data);
    return true;
  } catch {
    return false;
  }
}
