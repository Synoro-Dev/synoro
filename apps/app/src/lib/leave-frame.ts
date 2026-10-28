/**
 * Go to a page that refuses to be framed (a payment provider's checkout) in
 * the top window. Outside an iframe that is the window itself. Setting `href`
 * is a cross-origin `location` write browsers allow, but sandbox restrictions
 * or expired user activation may block it. Callers should offer a payment link
 * in case navigation is denied or silently ignored.
 */
export function leaveFrame(url: string) {
  try {
    (window.top ?? window).location.href = url;
  } catch (error) {
    // The payment already exists; navigation denial must not fail the mutation.
    if (!(error instanceof DOMException && error.name === "SecurityError")) {
      throw error;
    }
  }
}
