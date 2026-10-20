/** Full-page navigation to the hosted payment page. Wrapped so tests can mock it (jsdom cannot navigate). */
export function redirectTo(url: string) {
  window.location.assign(url);
}
