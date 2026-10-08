/* Sends enrollment form submissions to the Creativa CRM as well as to Netlify Forms.
   Fire-and-forget: if the CRM is unreachable the form still submits to Netlify as before.
   The key below is Supabase's public "anon" key — it can only call submit_inquiry(),
   which accepts these five forms and nothing else. */
(function () {
  var SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
  var SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
  var FORMS = { 'schedule-tour': 1, 'waitlist': 1, 'contact': 1, 'bloom-interest': 1, 'family-support': 1 };
  if (/YOUR-/.test(SUPABASE_URL + SUPABASE_ANON_KEY) || !window.fetch || !window.FormData) return;

  // Capture phase: runs before each page's own submit handler, which may preventDefault and post via fetch.
  // No validity check here on purpose: some pages (tour) send to Netlify without validating, and the CRM
  // should see whatever Netlify sees. A corrected resubmit within 2 minutes updates the same CRM row.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var name = form && form.getAttribute && form.getAttribute('name');
    if (!FORMS[name]) return;
    var data = {};
    new FormData(form).forEach(function (value, key) {
      if (typeof value !== 'string') return; // skip file inputs
      if (key.slice(-2) === '[]') (data[key] = data[key] || []).push(value);
      else data[key] = value;
    });
    try {
      fetch(SUPABASE_URL + '/rest/v1/rpc/submit_inquiry', {
        method: 'POST',
        keepalive: true, // survives the page navigating to the thank-you page
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
        body: JSON.stringify({ p_form: name, p_data: data })
      }).catch(function () {});
    } catch (err) { /* never block the form */ }
  }, true);
})();
