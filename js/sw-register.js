// Registers the offline app shell. A failure here must never break the page.
if ('serviceWorker' in navigator) {
  const register = () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.error('Service worker registration failed', err);
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
