/* Online registration (/registration/): sends the form to the Creativa CRM, where the office reviews it and adds the
   child to Enrollment. Only to the CRM (not Netlify Forms), since it has health and family details.
   The key below is Supabase's public "anon" key: it can only call submit_registration() and submit_inquiry(), which
   save a form for the office to review and nothing else. Cloudflare Turnstile ("are you human") is checked by the CRM. */
(function () {
  var SUPABASE_URL = 'https://drgwfjoirmgxwhclbaak.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyZ3dmam9pcm1neHdoY2xiYWFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NzcwMTAsImV4cCI6MjEwNzA1MzAxMH0.S1CnUIgIwzM9J8Qaom1A2vfalTFpmtXo1oTmLLznlbI';
  var TURNSTILE_SITE_KEY = '0x4AAAAAAFUtCK5STGi_XECQ';
  var WAIT_FOR_CHECK_MS = 12000;
  var form = document.getElementById('reg-form');
  if (!form || !window.fetch) return;
  var box = form.querySelector('.crm-turnstile'), errBox = document.getElementById('reg-error'), send = document.getElementById('reg-send');
  var widget = null, turnstileFailed = false;

  // ── "are you human" check: usually invisible; a suspicious visitor gets one checkbox.
  window.__regTurnstileReady = function () {
    try { widget = window.turnstile.render(box, { sitekey: TURNSTILE_SITE_KEY, appearance: 'interaction-only', action: 'registration' }); }
    catch (e) { turnstileFailed = true; }
  };
  var s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__regTurnstileReady';
  s.async = true; s.defer = true;
  s.onerror = function () { turnstileFailed = true; };
  document.head.appendChild(s);
  function token() { var i = form.querySelector('input[name="cf-turnstile-response"]'); return i ? i.value : ''; }

  // ── rows that repeat: emergency contacts, pick-up people, medicine
  Array.prototype.forEach.call(form.querySelectorAll('[data-add]'), function (btn) {
    var kind = btn.getAttribute('data-add'), rows = form.querySelector('[data-rows="' + kind + '"]');
    var max = Number(rows.getAttribute('data-max'));
    btn.addEventListener('click', function () {
      var n = rows.querySelectorAll('[data-row="' + kind + '"]').length;
      if (n >= max) return;
      var first = rows.querySelector('[data-row="' + kind + '"]'), second = rows.querySelector('[data-row2="' + kind + '"]');
      [first, second].forEach(function (tpl) {
        if (!tpl) return;
        var copy = tpl.cloneNode(true);
        Array.prototype.forEach.call(copy.querySelectorAll('[id],[name],[for]'), function (el) {
          ['id', 'name', 'for'].forEach(function (a) {
            var v = el.getAttribute(a);
            if (v) el.setAttribute(a, v.replace(new RegExp('^' + kind + '1_'), kind + (n + 1) + '_'));
          });
          if (el.value !== undefined && el.tagName !== 'LABEL') el.value = '';
        });
        rows.appendChild(copy);
      });
      if (n + 1 >= max) btn.hidden = true;
    });
  });

  // ── the second parent at the same address
  var same = document.getElementById('p2_same');
  if (same) same.addEventListener('change', function () {
    var a = document.getElementById('p2_address');
    a.disabled = same.checked;
    if (same.checked) a.value = document.getElementById('p1_address').value;
  });

  function val(name) { var el = form.elements[name]; return el && typeof el.value === 'string' ? el.value.trim() : ''; }
  function picked(name) { var el = form.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; }
  function checkedAll(name) { return Array.prototype.map.call(form.querySelectorAll('input[name="' + name + '"]:checked'), function (x) { return x.value; }); }
  function person(p) {
    return { relationship: val(p + '_rel'), first: val(p + '_first'), last: val(p + '_last'), cell: val(p + '_cell'), email: val(p + '_email'),
      address: p === 'p2' && same && same.checked ? val('p1_address') : val(p + '_address'), employer: val(p + '_employer'), work_phone: val(p + '_work_phone') };
  }
  function rows(kind) {
    var out = [];
    for (var k = 1; form.elements[kind + k + '_first'] || form.elements[kind + k + '_name']; k++) {
      if (kind === 'med') {
        if (val('med' + k + '_name')) out.push({ name: val('med' + k + '_name'), details: val('med' + k + '_details'), expires_on: val('med' + k + '_expires_on') });
      } else if (val(kind + k + '_first') || val(kind + k + '_last')) {
        out.push({ first: val(kind + k + '_first'), last: val(kind + k + '_last'), relationship: val(kind + k + '_rel'), cell: val(kind + k + '_cell') });
      }
    }
    return out;
  }
  function payload() {
    return {
      'cf-turnstile-response': token(), 'bot-field': val('bot-field'),
      child: { first: val('child_first'), last: val('child_last'), dob: val('child_dob'), program: val('program'), start_on: val('start_on'), schedule: picked('schedule') },
      parents: [person('p1'), person('p2')].filter(function (x) { return x.first || x.last; }),
      emergency: rows('ec'), pickups: rows('pu'),
      allergies: val('allergies'), medications: rows('med'),
      pediatrician: { name: val('ped_name'), phone: val('ped_phone') },
      rbt: picked('rbt'), rbt_note: val('rbt_note'), therapy: checkedAll('therapy'), therapy_note: val('therapy_note'),
      funding: checkedAll('funding'), award_id: val('award_id'), photo_ok: picked('photo_ok'), notes: val('notes'), signed_name: val('signed_name')
    };
  }
  function showError(msg) {
    errBox.textContent = msg;
    errBox.hidden = false;
    errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  var sending = false;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;
    errBox.hidden = true;
    if (!form.checkValidity()) {
      var bad = form.querySelector('input:invalid, select:invalid, textarea:invalid');
      showError('Please fill in the fields marked with *' + (bad && bad.labels && bad.labels[0] ? ': ' + bad.labels[0].textContent.replace('*', '').trim() : '') + '.');
      if (bad) bad.focus();
      return;
    }
    sending = true;
    send.disabled = true;
    send.textContent = 'Sending…';
    var started = Date.now();
    (function go() {
      // The check usually finishes before anyone reaches Send; wait a few seconds if it hasn't.
      if (!token() && !turnstileFailed && Date.now() - started < WAIT_FOR_CHECK_MS) return setTimeout(go, 250);
      fetch(SUPABASE_URL + '/rest/v1/rpc/submit_registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
        body: JSON.stringify({ p_data: payload() })
      }).then(function (res) {
        if (res.ok) {
          document.getElementById('reg-done-name').textContent = val('child_first') || 'your child';
          form.hidden = true;
          document.getElementById('reg-done').hidden = false;
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j && j.message ? j.message : 'Something went wrong. Please try again, or call us at (786) 900-0099.');
        });
      }).catch(function (err) {
        showError(err && err.message && !/fetch|network/i.test(err.message) ? err.message
          : 'We could not send it. Please check your internet connection and press Send again.');
        if (widget !== null && window.turnstile) { try { window.turnstile.reset(widget); } catch (x) { /* ignore */ } }
      }).then(function () {
        sending = false;
        send.disabled = false;
        send.innerHTML = 'Send Registration &rarr;';
      });
    })();
  });
})();
