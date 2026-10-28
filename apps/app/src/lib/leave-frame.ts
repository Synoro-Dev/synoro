/**
 * Go to a page that refuses to be framed (a payment provider's checkout) in
 * the top window. Outside an iframe that is the window itself. Setting `href`
 * is the one cross-origin `location` write browsers allow; they let it through
 * for a click that just happened, which covers the request in between.
 */
export function leaveFrame(url: string) {
  (window.top ?? window).location.href = url;
}
