/* Sends enrollment form submissions to the Creativa CRM as well as to Netlify Forms,
   with Cloudflare Turnstile's "are you human" check on each form.
   Fire-and-forget: if the CRM is unreachable the form still submits to Netlify as before.
   The key below is Supabase's public "anon" key — it can only call submit_inquiry(),
   which accepts these five forms and nothing else. The Turnstile site key is public too;
   its secret half lives only in the CRM's Supabase Vault, which checks every token. */
(function () {
  var SUPABASE_URL = 'https://drgwfjoirmgxwhclbaak.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyZ3dmam9pcm1neHdoY2xiYWFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NzcwMTAsImV4cCI6MjEwNzA1MzAxMH0.S1CnUIgIwzM9J8Qaom1A2vfalTFpmtXo1oTmLLznlbI';
  var TURNSTILE_SITE_KEY = '0x4AAAAAAFUtCK5STGi_XECQ';
  var FORMS = { 'schedule-tour': 1, 'waitlist': 1, 'contact': 1, 'bloom-interest': 1, 'family-support': 1 };
  var WAIT_FOR_CHECK_MS = 12000;
  if (/YOUR-/.test(SUPABASE_URL + SUPABASE_ANON_KEY) || !window.fetch || !window.FormData) return;
  var turnstileOn = !/YOUR-/.test(TURNSTILE_SITE_KEY);

  function targetForms() {
    return Array.prototype.filter.call(document.querySelectorAll('form[name]'), function (f) {
      return FORMS[f.getAttribute('name')];
    });
  }
  function token(form) {
    var input = form.querySelector('input[name="cf-turnstile-response"]');
    return input ? input.value : '';
  }

  // ── Texting notice under the phone field (carriers require it before the CRM may text tour reminders).
  targetForms().forEach(function (form) {
    var phone = form.querySelector('input[type="tel"], input[name="phone"], input[name="parent-phone"]');
    if (!phone || form.querySelector('.crm-sms-note')) return;
    var note = document.createElement('p');
    note.className = 'crm-sms-note';
    note.style.cssText = 'margin:6px 0 0;font-size:12.5px;line-height:1.45;opacity:.75';
    note.appendChild(document.createTextNode('By sharing your phone number, you agree that Creativa Academy may text you about ' +
      'your inquiry and tour (for example, a reminder the day before). Usually 1–3 messages. Msg & data rates may apply. ' +
      'Reply STOP to opt out, HELP for help. '));
    var link = document.createElement('a');
    link.href = '/privacy/';
    link.textContent = 'Privacy policy';
    note.appendChild(link);
    var field = phone.closest('.field') || phone.parentNode;
    field.appendChild(note);
  });

  // ── Turnstile widget: one per form, just above the submit button. Usually invisible;
  //    a suspicious visitor gets a single checkbox.
  if (turnstileOn) {
    window.__crmTurnstileReady = function () {
      targetForms().forEach(function (form) {
        if (form.querySelector('.crm-turnstile')) return;
        var box = document.createElement('div');
        box.className = 'crm-turnstile';
        box.style.margin = '12px 0';
        var submit = form.querySelector('[type="submit"]');
        if (submit && submit.parentNode && form.contains(submit)) submit.parentNode.insertBefore(box, submit);
        else form.appendChild(box);
        window.turnstile.render(box, { sitekey: TURNSTILE_SITE_KEY, appearance: 'interaction-only', action: form.getAttribute('name') });
      });
    };
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__crmTurnstileReady';
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }

  // Capture phase: runs before each page's own submit handler, which may preventDefault and post via fetch.
  // Each page only sends a form once its required fields pass, so skip invalid attempts here too.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var name = form && form.getAttribute && form.getAttribute('name');
    if (!FORMS[name]) return;
    if (typeof form.checkValidity === 'function' && !form.checkValidity()) return;

    // The check usually finishes before anyone reaches Submit. If it hasn't, hold this submit
    // (stop the page's own handler too) and send it as soon as the check is done. If the check
    // never finishes (e.g. Cloudflare blocked), send anyway after a few seconds: Netlify still gets it.
    if (turnstileOn && !token(form) && !form.__crmWaited) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (form.__crmWaiting) return;
      form.__crmWaiting = true;
      var note = form.querySelector('.crm-turnstile-note');
      if (!note) {
        note = document.createElement('p');
        note.className = 'crm-turnstile-note';
        note.setAttribute('role', 'status');
        note.style.cssText = 'margin:8px 0;font-size:14px;opacity:.8';
        (form.querySelector('.crm-turnstile') || form).appendChild(note);
      }
      note.textContent = 'One moment — checking that you’re not a robot…';
      var started = Date.now();
      var timer = setInterval(function () {
        if (token(form) || Date.now() - started > WAIT_FOR_CHECK_MS) {
          clearInterval(timer);
          form.__crmWaiting = false;
          form.__crmWaited = true;
          note.textContent = '';
          if (form.requestSubmit) form.requestSubmit(); else form.submit();
        }
      }, 250);
      return;
    }
    form.__crmWaited = false;

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
