function fallbackCopyToClipboard(text) {
  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;

  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  return copied;
}

async function copyText(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallbackCopyToClipboard(text);
    }
  }

  return fallbackCopyToClipboard(text);
}

function buildFeatureShareText({ lines, title }) {
  return [title, ...lines.filter(Boolean)].join('\n');
}

async function shareFeatureSummary({ lines = [], title }) {
  const safeTitle = String(title || 'Ficha de obra').trim() || 'Ficha de obra';
  const text = buildFeatureShareText({ lines, title: safeTitle });

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: safeTitle, text });
      return { status: 'shared', text };
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { status: 'cancelled', text };
      }
    }
  }

  const copied = await copyText(text);

  return {
    status: copied ? 'copied' : 'unsupported',
    text,
  };
}

export { shareFeatureSummary };
