/* Bloom Bar visit counter: counts page views for the studio app's Report.
   A random id in this browser, the page, and where the visit came from.
   Visit any page with ?notrack=1 once to stop counting this device (Izza's
   and Nicolo's phones), ?notrack=0 to undo. */
(function () {
  try {
    var q = new URLSearchParams(location.search)
    var get = function (s, k) { try { return s.getItem(k) } catch (e) { return null } }
    var set = function (s, k, v) { try { s.setItem(k, v) } catch (e) {} }

    if (q.get('notrack') === '1') set(localStorage, 'bb_notrack', '1')
    if (q.get('notrack') === '0') { try { localStorage.removeItem('bb_notrack') } catch (e) {} }

    // Where this visit started: kept for the whole visit (this tab)
    var first = null
    try { first = JSON.parse(get(sessionStorage, 'bb_first') || 'null') } catch (e) {}
    var landing = !first
    if (!first) {
      first = {
        ref: document.referrer || '',
        utm: q.get('utm_source') || '',
        medium: q.get('utm_medium') || '',
        ad: !!(q.get('gclid') || q.get('gbraid') || q.get('wbraid') || q.get('gad_source')),
      }
      set(sessionStorage, 'bb_first', JSON.stringify(first))
    }
    window.bbVisit = first      // sent along with brow checks and booking requests

    if (get(localStorage, 'bb_notrack') || navigator.webdriver) return

    var visitor = get(localStorage, 'bb_vid')
    if (!visitor) {
      visitor = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/[^a-z0-9-]/gi, '').slice(0, 36)
      set(localStorage, 'bb_vid', visitor)
    }

    var body = JSON.stringify({ visitor: visitor, page: location.pathname, first: first, landing: landing })
    if (!(navigator.sendBeacon && navigator.sendBeacon('/api/visit', body))) {
      fetch('/api/visit', { method: 'POST', body: body, keepalive: true }).catch(function () {})
    }
  } catch (e) {}
})()
