/* HASTECH School Management System - browser app.
   Single page: each section is a <div class="page"> shown/hidden by navigateTo().
   All data comes from /api/rpc for the school named in the URL (e.g. /bright-future). */
(function () {
  'use strict';

  var SLUG = (location.pathname.split('/')[1] || '').toLowerCase();
  var STATE = {
    admin: null,
    settings: {},
    modules: [],
    classes: [],
    students: [],
    announcements: [],
    attendance: { className: '', date: '', statuses: {} },
    pending: false
  };
  var ROLE_RANK = { STAFF: 1, ADMIN: 2, SUPER_ADMIN: 3 };

  function $(id) { return document.getElementById(id); }

  // ---------------- Server calls ----------------
  function api(path, options) {
    options = options || {};
    var headers = { 'X-Hastech-Request': '1' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      credentials: 'same-origin',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        var err = new Error(data.error || 'Something went wrong. Please try again.');
        err.status = res.status;
        throw err;
      });
    });
  }

  /** Calls a server function for this school. Rejects with a friendly Error. */
  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return api('/api/rpc', { method: 'POST', body: { school: SLUG, fn: fn, args: args } })
      .then(function (data) { return data.result; })
      .catch(function (err) {
        if (err.status === 401) { showLogin('Your session has ended. Please sign in again.'); }
        throw err;
      });
  }

  function pdfUrl(params) {
    var q = new URLSearchParams(Object.assign({ school: SLUG }, params));
    return '/api/pdf?' + q.toString();
  }

  // ---------------- UI helpers ----------------
  function showLoader(text) { $('loader-text').textContent = text || 'Loading...'; $('global-loader').classList.add('visible'); }
  function hideLoader() { $('global-loader').classList.remove('visible'); }

  function toast(message, type, title) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = '<div class="toast-title">' + escapeHtml(title || (type === 'error' ? 'Error' : 'Success')) + '</div><div>' + escapeHtml(message) + '</div>';
    $('toast-container').appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s ease';
      setTimeout(function () { el.remove(); }, 300);
    }, 4000);
  }
  function errorToast(err) { toast((err && err.message) || 'Something went wrong. Please try again.', 'error'); }

  /** Shows a server result: success toast, or its message as an error. Returns true on success. */
  function reportResult(res) {
    if (res && res.success) { toast(res.message, 'success'); return true; }
    toast((res && res.message) || 'Something went wrong. Please try again.', 'error');
    return false;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatCurrency(amount) {
    var n = parseFloat(amount) || 0;
    return (STATE.settings.CURRENCY || 'GHS') + ' ' + n.toFixed(2);
  }

  function parseDate(value) {
    if (!value) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(value) {
    var d = parseDate(value);
    if (!d) return value ? String(value) : 'N/A';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function toDateInputValue(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return value;
    var d = parseDate(value);
    if (!d) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function todayInput() { return toDateInputValue(new Date()); }

  function debounce(fn, delay) {
    var timer;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, delay);
    };
  }

  function setBtnLoading(btn, loading, label) {
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading ? '<span class="spinner"></span> ' + escapeHtml(label) : escapeHtml(label);
  }

  /** Runs a save action once at a time, with a busy button. */
  function submitWith(btn, busyLabel, idleLabel, promiseFn) {
    if (STATE.pending) return Promise.resolve();
    STATE.pending = true;
    setBtnLoading(btn, true, busyLabel);
    return promiseFn().catch(errorToast).then(function (v) {
      STATE.pending = false;
      setBtnLoading(btn, false, idleLabel);
      return v;
    });
  }

  function emptyState(msg) {
    return '<div class="empty-state"><div class="empty-icon">&#128203;</div>' + escapeHtml(msg) + '</div>';
  }

  function loadingRow(cols, text) {
    return '<tr><td colspan="' + cols + '"><div class="empty-state"><span class="spinner dark"></span> ' + escapeHtml(text) + '</div></td></tr>';
  }

  function attr(name, value) { return ' ' + name + '="' + escapeHtml(value) + '"'; }

  function actionButton(label, action, data, cls) {
    var html = '<button type="button" class="btn ' + (cls || 'btn-outline') + ' btn-sm"' + attr('data-action', action);
    Object.keys(data || {}).forEach(function (k) { html += attr('data-' + k, data[k]); });
    return html + '>' + escapeHtml(label) + '</button>';
  }

  // ---------------- Branding / features / roles ----------------
  function shade(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var f = function (c) { return Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount))); };
    return '#' + [f(r), f(g), f(b)].map(function (c) { return c.toString(16).padStart(2, '0'); }).join('');
  }

  function applyBranding(s) {
    var root = document.documentElement.style;
    var primary = /^#[0-9a-fA-F]{6}$/.test(s.PRIMARY_COLOR || '') ? s.PRIMARY_COLOR : '#0F2A4A';
    var accent = /^#[0-9a-fA-F]{6}$/.test(s.ACCENT_COLOR || '') ? s.ACCENT_COLOR : '#2FB8A3';
    root.setProperty('--navy', primary);
    root.setProperty('--navy-dark', shade(primary, -0.3));
    root.setProperty('--navy-light', shade(primary, 0.2));
    root.setProperty('--accent', accent);
    root.setProperty('--accent-dark', shade(accent, -0.2));

    var name = s.SCHOOL_NAME || 'School';
    document.title = name + ' | School Management System';
    $('login-school-name').textContent = name;
    $('login-motto').textContent = s.SCHOOL_MOTTO || '';
    $('school-name-side').textContent = name;
    var initial = name.charAt(0).toUpperCase();
    $('login-brand-icon').textContent = initial;
    $('side-badge').textContent = initial;

    var logo = /^https:\/\//i.test(s.SCHOOL_LOGO_URL || '') ? s.SCHOOL_LOGO_URL : '';
    [['login-logo', 'login-brand-icon'], ['side-logo', 'side-badge']].forEach(function (pair) {
      var img = $(pair[0]);
      if (logo) {
        img.onerror = function () { img.classList.add('hidden'); $(pair[1]).classList.remove('hidden'); };
        img.src = logo;
        img.classList.remove('hidden');
        $(pair[1]).classList.add('hidden');
      } else {
        img.classList.add('hidden');
        $(pair[1]).classList.remove('hidden');
      }
    });
  }

  function moduleOn(name) { return STATE.modules.indexOf(name) !== -1; }
  function roleAtLeast(role) { return STATE.admin && (ROLE_RANK[STATE.admin.role] || 0) >= ROLE_RANK[role]; }

  function applySettings(settings) {
    STATE.settings = settings || {};
    STATE.modules = String(STATE.settings.ENABLED_MODULES || '').split(',').map(function (m) { return m.trim(); }).filter(Boolean);
    applyBranding(STATE.settings);
    document.querySelectorAll('[data-module]').forEach(function (el) {
      el.classList.toggle('hidden', !moduleOn(el.getAttribute('data-module')));
      if (el.tagName === 'OPTION') el.disabled = !moduleOn(el.getAttribute('data-module'));
    });
    document.querySelectorAll('[data-min-role]').forEach(function (el) {
      el.classList.toggle('hidden', !roleAtLeast(el.getAttribute('data-min-role')));
    });
    var reportType = $('report-type');
    if (reportType.selectedOptions[0] && reportType.selectedOptions[0].disabled) { reportType.value = 'STUDENT_LIST'; updateReportFilters(); }
  }

  // ---------------- Start-up & sign-in ----------------
  document.addEventListener('DOMContentLoaded', function () {
    bindGlobalUI();
    start();
  });

  function start() {
    if (!SLUG) {
      hideLoader();
      $('landing-screen').classList.remove('hidden');
      return;
    }
    api('/api/school?slug=' + encodeURIComponent(SLUG)).then(function (school) {
      applyBranding(school.branding || {});
      STATE.school = school;
      return api('/api/session?school=' + encodeURIComponent(SLUG)).then(enterApp).catch(function (err) {
        showLogin(err.status === 403 ? err.message : '');
      });
    }).catch(function (err) {
      hideLoader();
      $('landing-error').textContent = err.status === 404 ? 'We couldn’t find a school at this link. Check the address you were given.' : 'Could not connect. Please refresh the page.';
      $('landing-screen').classList.remove('hidden');
    });
  }

  function showLogin(message) {
    hideLoader();
    $('app-shell').classList.remove('visible');
    $('login-screen').classList.remove('hidden');
    $('login-error').textContent = message || '';
    var school = STATE.school || {};
    if (school.testMode) $('test-login-form').classList.remove('hidden');
    if (school.googleClientId) renderGoogleButton(school.googleClientId);
    else if (!school.testMode) $('login-error').textContent = 'Google sign-in is not configured for this site yet.';
  }

  var gsiLoaded = false;
  function renderGoogleButton(clientId) {
    var draw = function () {
      window.google.accounts.id.initialize({ client_id: clientId, callback: onGoogleCredential, ux_mode: 'popup' });
      $('gsi-button').innerHTML = '';
      window.google.accounts.id.renderButton($('gsi-button'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 280 });
    };
    if (gsiLoaded && window.google && window.google.accounts) return draw();
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = function () { gsiLoaded = true; draw(); };
    s.onerror = function () { $('login-error').textContent = 'Could not load Google sign-in. Check your internet connection.'; };
    document.head.appendChild(s);
  }

  function onGoogleCredential(response) {
    signIn({ school: SLUG, credential: response.credential });
  }

  function signIn(body) {
    $('login-error').textContent = '';
    showLoader('Signing in...');
    api('/api/session', { method: 'POST', body: body }).then(enterApp).catch(function (err) {
      hideLoader();
      $('login-error').textContent = err.message;
    });
  }

  function signOut() {
    api('/api/session', { method: 'DELETE' }).catch(function () {}).then(function () {
      STATE.admin = null;
      if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect();
      showLogin('You have signed out.');
    });
  }

  function enterApp(member) {
    STATE.admin = member;
    hideLoader();
    $('login-screen').classList.add('hidden');
    $('app-shell').classList.add('visible');
    $('user-name').textContent = member.name;
    $('user-role').textContent = String(member.role || '').replace('_', ' ').toLowerCase();
    $('dashboard-admin-name').textContent = String(member.name || '').split(' ')[0];
    $('user-avatar').textContent = (member.name || 'A').charAt(0).toUpperCase();
    if (member.picture) {
      $('user-picture').src = member.picture;
      $('user-picture').classList.remove('hidden');
      $('user-avatar').classList.add('hidden');
    }
    applySettings(member.settings);
    loadClasses();
    navigateTo('dashboard');
  }

  // ---------------- Navigation ----------------
  var PAGE_TITLES = {
    dashboard: 'Dashboard', students: 'Student Directory', 'register-student': 'Register Student',
    attendance: 'Attendance', payments: 'Payments', announcements: 'Announcements',
    reports: 'Reports', settings: 'Settings', 'student-profile': 'Student Profile'
  };
  var PAGE_MODULE = { attendance: 'attendance', payments: 'payments', announcements: 'announcements', reports: 'reports' };

  function navigateTo(page) {
    if (PAGE_MODULE[page] && !moduleOn(PAGE_MODULE[page])) page = 'dashboard';
    if (page === 'settings' && !roleAtLeast('ADMIN')) page = 'dashboard';
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    var target = $('page-' + page);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item[data-page]').forEach(function (item) {
      item.classList.toggle('active', item.getAttribute('data-page') === page);
    });
    $('page-title').textContent = PAGE_TITLES[page] || '';
    closeMobileSidebar();
    window.scrollTo(0, 0);

    if (page === 'dashboard') loadDashboard();
    else if (page === 'students') loadStudents();
    else if (page === 'register-student') resetStudentForm();
    else if (page === 'attendance') loadAttendanceStudents();
    else if (page === 'payments') loadPayments();
    else if (page === 'announcements') loadAnnouncements();
    else if (page === 'settings') loadSettingsPage();
  }

  function closeMobileSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebar-backdrop').classList.remove('visible');
  }

  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }

  function bindGlobalUI() {
    document.querySelectorAll('.nav-item[data-page]').forEach(function (item) {
      item.addEventListener('click', function () { navigateTo(item.getAttribute('data-page')); });
    });
    document.querySelectorAll('[data-quick-action]').forEach(function (btn) {
      btn.addEventListener('click', function () { navigateTo(btn.getAttribute('data-quick-action')); });
    });
    $('logout-btn').addEventListener('click', signOut);
    $('mobile-menu-btn').addEventListener('click', function () {
      $('sidebar').classList.add('open');
      $('sidebar-backdrop').classList.add('visible');
    });
    $('sidebar-backdrop').addEventListener('click', closeMobileSidebar);
    document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(overlay.id); });
    });
    document.querySelectorAll('[data-close-modal]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeModal(btn.getAttribute('data-close-modal')); });
    });
    $('test-login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      signIn({ school: SLUG, testEmail: $('test-login-email').value.trim() });
    });
    document.addEventListener('click', onAction);

    bindStudentForm();
    bindAttendanceUI();
    bindPaymentForm();
    bindAnnouncementForm();
    bindReportsUI();
    bindSettingsUI();
  }

  /** One click handler for every button generated from data (no inline onclick). */
  function onAction(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var d = el.dataset;
    switch (d.action) {
      case 'view-student': return viewStudentProfile(d.id);
      case 'edit-student': return editStudent(d.id);
      case 'profile-pdf': return openPdf({ type: 'profile', id: d.id });
      case 'attendance-status': return setAttendanceStatus(d.id, d.status);
      case 'receipt': return openPdf({ type: 'receipt', id: d.id });
      case 'pick-payment-student': return selectPaymentStudent(d.id, d.name);
      case 'ann-edit': return editAnnouncement(d.id);
      case 'ann-toggle': return togglePublishAnnouncement(d.id, d.status);
      case 'ann-delete': return removeAnnouncement(d.id);
      case 'admin-toggle': return toggleAdminStatus(d.id, d.status);
    }
  }

  function openPdf(params) {
    var w = window.open(pdfUrl(params), '_blank');
    if (!w) toast('Allow pop-ups for this site to open the PDF.', 'error');
  }

  // ================= DASHBOARD =================
  function loadDashboard() {
    call('getDashboardStats').then(function (stats) {
      $('stat-total-students').textContent = stats.totalStudents;
      $('stat-active-students').textContent = stats.activeStudents;
      $('stat-total-classes').textContent = stats.totalClasses;
      $('stat-today-attendance').textContent = stats.todayAttendance.present + ' / ' + stats.todayAttendance.total;
      $('stat-outstanding-fees').textContent = formatCurrency(stats.outstandingFees);
      $('stat-payments-month').textContent = formatCurrency(stats.paymentsThisMonth.total);

      $('recent-students-list').innerHTML = stats.recentStudents.length ? stats.recentStudents.map(function (s) {
        return '<div class="attendance-row"><div><strong>' + escapeHtml(s.FIRST_NAME + ' ' + s.LAST_NAME) + '</strong><div class="muted">' + escapeHtml(s.STUDENT_ID) + ' &middot; ' + escapeHtml(s.CLASS) + '</div></div>' +
          actionButton('View', 'view-student', { id: s.STUDENT_ID }) + '</div>';
      }).join('') : emptyState('No students registered yet.');

      $('recent-activity-list').innerHTML = stats.recentActivity.length ? stats.recentActivity.map(function (a) {
        return '<div class="attendance-row"><div><strong>' + escapeHtml(a.ACTION) + '</strong><div class="muted">' + escapeHtml(a.DESCRIPTION) + '</div></div>' +
          '<div class="muted" style="white-space:nowrap;">' + formatDate(a.TIMESTAMP) + '</div></div>';
      }).join('') : emptyState('No activity yet.');

      $('dashboard-announcements-list').innerHTML = stats.announcements.length ? stats.announcements.map(function (a) {
        var msg = String(a.MESSAGE || '');
        return '<div class="attendance-row"><div><strong>' + escapeHtml(a.TITLE) + '</strong><div class="muted">' + escapeHtml(msg.length > 90 ? msg.slice(0, 90) + '...' : msg) + '</div></div>' +
          '<span class="badge badge-blue">' + escapeHtml(a.AUDIENCE) + '</span></div>';
      }).join('') : emptyState('No announcements published.');
    }).catch(errorToast);
  }

  // ================= CLASSES (shared dropdowns) =================
  function loadClasses() {
    return call('getClasses').then(function (classes) {
      STATE.classes = classes || [];
      document.querySelectorAll('.class-select-source').forEach(function (sel) {
        var first = sel.querySelector('option');
        var keepFirst = sel.getAttribute('data-keep-first') === 'true' && first;
        var current = sel.value;
        sel.innerHTML = (keepFirst ? first.outerHTML : '') + STATE.classes.map(function (c) {
          return '<option' + attr('value', c.CLASS_NAME) + '>' + escapeHtml(c.CLASS_NAME) + '</option>';
        }).join('');
        if (current) sel.value = current;
      });
      return STATE.classes;
    }).catch(errorToast);
  }

  // ================= STUDENTS =================
  function statusBadge(status) {
    var map = { ACTIVE: 'badge-green', INACTIVE: 'badge-gray', GRADUATED: 'badge-blue', TRANSFERRED: 'badge-orange' };
    return '<span class="badge ' + (map[status] || 'badge-gray') + '">' + escapeHtml(status) + '</span>';
  }

  function loadStudents() {
    var filters = {
      search: $('student-search').value.trim(),
      className: $('student-filter-class').value,
      gender: $('student-filter-gender').value,
      status: $('student-filter-status').value
    };
    var tbody = $('students-table-body');
    tbody.innerHTML = loadingRow(7, 'Loading students...');
    call('getStudents', filters).then(function (students) {
      STATE.students = students || [];
      if (!STATE.students.length) { tbody.innerHTML = '<tr><td colspan="7">' + emptyState('No students found.') + '</td></tr>'; return; }
      tbody.innerHTML = STATE.students.map(function (s) {
        return '<tr>' +
          '<td data-label="Student ID"><strong>' + escapeHtml(s.STUDENT_ID) + '</strong></td>' +
          '<td data-label="Name">' + escapeHtml(s.FIRST_NAME + ' ' + s.LAST_NAME) + '</td>' +
          '<td data-label="Class">' + escapeHtml(s.CLASS) + '</td>' +
          '<td data-label="Gender">' + escapeHtml(s.GENDER) + '</td>' +
          '<td data-label="Status">' + statusBadge(s.STATUS) + '</td>' +
          '<td data-label="Registered">' + formatDate(s.CREATED_AT) + '</td>' +
          '<td data-label="Actions">' + actionButton('View Profile', 'view-student', { id: s.STUDENT_ID }) + '</td>' +
          '</tr>';
      }).join('');
    }).catch(function (err) {
      tbody.innerHTML = '<tr><td colspan="7">' + emptyState(err.message || 'Could not load students.') + '</td></tr>';
    });
  }

  var STUDENT_FIELDS = {
    firstName: 'sf-first-name', middleName: 'sf-middle-name', lastName: 'sf-last-name', dob: 'sf-dob', gender: 'sf-gender',
    className: 'sf-class', academicYear: 'sf-academic-year', admissionDate: 'sf-admission-date', phone: 'sf-phone', email: 'sf-email',
    address: 'sf-address', previousSchool: 'sf-previous-school', status: 'sf-status', photoUrl: 'sf-photo-url',
    guardianName: 'sf-guardian-name', guardianRelationship: 'sf-guardian-relationship', guardianPhone: 'sf-guardian-phone',
    guardianEmail: 'sf-guardian-email', guardianOccupation: 'sf-guardian-occupation', guardianAddress: 'sf-guardian-address'
  };

  function bindStudentForm() {
    $('student-search').addEventListener('input', debounce(loadStudents, 350));
    ['student-filter-class', 'student-filter-gender', 'student-filter-status'].forEach(function (id) {
      $(id).addEventListener('change', loadStudents);
    });

    $('student-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var data = { studentId: $('sf-editing-id').value };
      Object.keys(STUDENT_FIELDS).forEach(function (k) { data[k] = $(STUDENT_FIELDS[k]).value; });
      if (!data.firstName.trim()) return toast('Please enter the student’s first name.', 'error');
      if (!data.lastName.trim()) return toast('Please enter the student’s last name.', 'error');
      if (!data.className) return toast('Please select a class.', 'error');
      var isEdit = !!data.studentId;
      var idle = isEdit ? 'Save Changes' : 'Register Student';
      submitWith($('student-submit-btn'), isEdit ? 'Saving...' : 'Registering student...', idle, function () {
        return call(isEdit ? 'updateStudent' : 'createStudent', data).then(function (res) {
          if (!reportResult(res)) return;
          if (isEdit) viewStudentProfile(data.studentId);
          else navigateTo('students');
        });
      });
    });
  }

  function resetStudentForm() {
    $('student-form').reset();
    $('sf-editing-id').value = '';
    $('student-form-title').textContent = 'Register Student';
    $('student-submit-btn').textContent = 'Register Student';
    $('sf-academic-year').value = STATE.settings.ACADEMIC_YEAR || '';
    $('sf-admission-date').value = todayInput();
  }

  function editStudent(studentId) {
    showLoader('Loading student...');
    call('getStudentProfile', studentId).then(function (profile) {
      hideLoader();
      if (!profile.success) return toast(profile.message, 'error');
      navigateTo('register-student');
      var s = profile.student, g = profile.guardians[0] || {};
      $('student-form-title').textContent = 'Edit Student';
      $('student-submit-btn').textContent = 'Save Changes';
      $('sf-editing-id').value = s.STUDENT_ID;
      var values = {
        firstName: s.FIRST_NAME, middleName: s.MIDDLE_NAME, lastName: s.LAST_NAME, dob: toDateInputValue(s.DOB), gender: s.GENDER,
        className: s.CLASS, academicYear: s.ACADEMIC_YEAR, admissionDate: toDateInputValue(s.ADMISSION_DATE), phone: s.PHONE,
        email: s.EMAIL, address: s.ADDRESS, previousSchool: s.PREVIOUS_SCHOOL, status: s.STATUS, photoUrl: s.PHOTO_URL,
        guardianName: g.NAME, guardianRelationship: g.RELATIONSHIP, guardianPhone: g.PHONE, guardianEmail: g.EMAIL,
        guardianOccupation: g.OCCUPATION, guardianAddress: g.ADDRESS
      };
      Object.keys(STUDENT_FIELDS).forEach(function (k) { $(STUDENT_FIELDS[k]).value = values[k] === undefined || values[k] === null ? '' : values[k]; });
    }).catch(function (err) { hideLoader(); errorToast(err); });
  }

  function viewStudentProfile(studentId) {
    navigateTo('student-profile');
    var body = $('student-profile-body');
    body.innerHTML = '<div class="empty-state"><span class="spinner dark"></span> Loading profile...</div>';
    call('getStudentProfile', studentId).then(function (profile) {
      if (!profile.success) { body.innerHTML = emptyState(profile.message || 'Student not found.'); return; }
      renderStudentProfile(profile);
    }).catch(function (err) { body.innerHTML = emptyState(err.message || 'Could not load student profile.'); });
  }

  function infoItem(label, value) {
    return '<div class="info-item"><div class="info-label">' + escapeHtml(label) + '</div><div class="info-value">' + escapeHtml(value) + '</div></div>';
  }

  function renderStudentProfile(profile) {
    var s = profile.student, g = profile.guardians[0] || {};
    var att = profile.attendanceSummary, pay = profile.paymentSummary;
    var initials = (String(s.FIRST_NAME).charAt(0) + String(s.LAST_NAME).charAt(0)).toUpperCase();
    var pct = att.percentage;
    var pctClass = pct >= 80 ? '' : (pct >= 60 ? 'warn' : 'danger');
    var photo = /^https:\/\//i.test(s.PHOTO_URL || '') ? '<img' + attr('src', s.PHOTO_URL) + ' alt="">' : escapeHtml(initials);

    var html = '<div class="profile-header"><div class="profile-photo">' + photo + '</div>' +
      '<div><h2 style="margin-bottom:2px;">' + escapeHtml(s.FIRST_NAME + ' ' + s.LAST_NAME) + '</h2>' +
      '<div class="muted" style="font-size:13px;">' + escapeHtml(s.STUDENT_ID) + ' &middot; ' + escapeHtml(s.CLASS) + ' &middot; ' + statusBadge(s.STATUS) + '</div></div></div>';

    html += '<div class="quick-actions" style="margin-bottom:20px;">' +
      actionButton('Edit', 'edit-student', { id: s.STUDENT_ID }) +
      actionButton('Download Profile PDF', 'profile-pdf', { id: s.STUDENT_ID }, 'btn-accent') + '</div>';

    html += '<div class="grid-2"><div class="card"><div class="section-title">Student Information</div><div class="info-grid">' +
      infoItem('Date of Birth', formatDate(s.DOB)) + infoItem('Gender', s.GENDER) + infoItem('Academic Year', s.ACADEMIC_YEAR) +
      infoItem('Admission Date', formatDate(s.ADMISSION_DATE)) + infoItem('Phone', s.PHONE || 'N/A') + infoItem('Email', s.EMAIL || 'N/A') +
      infoItem('Address', s.ADDRESS || 'N/A') + infoItem('Previous School', s.PREVIOUS_SCHOOL || 'N/A') + '</div></div>';

    html += '<div class="card"><div class="section-title">Guardian</div><div class="info-grid">' +
      infoItem('Name', g.NAME || 'N/A') + infoItem('Relationship', g.RELATIONSHIP || 'N/A') + infoItem('Phone', g.PHONE || 'N/A') +
      infoItem('Email', g.EMAIL || 'N/A') + infoItem('Occupation', g.OCCUPATION || 'N/A') + infoItem('Address', g.ADDRESS || 'N/A') + '</div></div></div>';

    html += '<div class="grid-2" style="margin-top:18px;">';
    if (moduleOn('attendance')) {
      html += '<div class="card"><div class="section-title">Attendance Summary</div>' +
        '<div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;"><div style="font-size:28px;font-weight:800;color:var(--navy);">' + pct + '%</div>' +
        '<div style="flex:1;"><div class="progress-track"><div class="progress-fill ' + pctClass + '" style="width:' + pct + '%;"></div></div></div></div>' +
        '<div class="info-grid">' + infoItem('Total Days', att.totalDays) + infoItem('Present', att.present) + infoItem('Absent', att.absent) + infoItem('Late', att.late) + '</div></div>';
    }
    if (moduleOn('payments')) {
      html += '<div class="card"><div class="section-title">Payment Summary</div><div class="info-grid">' +
        infoItem('Total Paid', formatCurrency(pay.totalPaid)) + infoItem('Expected Fee', formatCurrency(pay.expectedFee)) + infoItem('Outstanding', formatCurrency(pay.outstanding)) +
        '</div><div style="margin-top:14px;">' + (pay.payments.length ? pay.payments.slice(0, 5).map(function (p) {
          return '<div class="attendance-row"><div>' + escapeHtml(p.PAYMENT_TYPE) + '<div class="muted">' + formatDate(p.PAYMENT_DATE) + '</div></div><strong>' + formatCurrency(p.AMOUNT) + '</strong></div>';
        }).join('') : emptyState('No payments recorded.')) + '</div></div>';
    }
    html += '</div>';
    $('student-profile-body').innerHTML = html;
  }

  // ================= ATTENDANCE =================
  function bindAttendanceUI() {
    $('att-date').value = todayInput();
    $('att-class').addEventListener('change', loadAttendanceStudents);
    $('att-date').addEventListener('change', loadAttendanceStudents);
    $('att-mark-all-present').addEventListener('click', function () {
      Object.keys(STATE.attendance.statuses).forEach(function (id) { setAttendanceStatus(id, 'Present'); });
    });
    $('attendance-form').addEventListener('submit', function (e) { e.preventDefault(); saveAttendance(); });
  }

  function loadAttendanceStudents() {
    var className = $('att-class').value;
    var date = $('att-date').value;
    var list = $('attendance-student-list');
    STATE.attendance = { className: className, date: date, statuses: {} };
    if (!className || !date) { list.innerHTML = emptyState('Select a class and date to take attendance.'); return; }
    list.innerHTML = '<div class="empty-state"><span class="spinner dark"></span> Loading students...</div>';
    Promise.all([call('getStudentsForAttendance', className), call('getExistingAttendance', date, className)]).then(function (results) {
      var students = results[0] || [], existing = results[1] || {};
      if (STATE.attendance.className !== className || STATE.attendance.date !== date) return;
      if (!students.length) { list.innerHTML = emptyState('No active students in this class.'); return; }
      list.innerHTML = students.map(function (s) {
        var status = existing[s.STUDENT_ID] || 'Present';
        STATE.attendance.statuses[s.STUDENT_ID] = status;
        return '<div class="attendance-row"' + attr('data-student-id', s.STUDENT_ID) + '>' +
          '<div><strong>' + escapeHtml(s.FIRST_NAME + ' ' + s.LAST_NAME) + '</strong><div class="muted">' + escapeHtml(s.STUDENT_ID) + '</div></div>' +
          '<div class="attendance-status-btns">' + ['Present', 'Absent', 'Late'].map(function (st) {
            return '<button type="button" class="status-btn ' + st.toLowerCase() + (status === st ? ' selected' : '') + '"' +
              attr('data-action', 'attendance-status') + attr('data-id', s.STUDENT_ID) + attr('data-status', st) + '>' + st + '</button>';
          }).join('') + '</div></div>';
      }).join('');
    }).catch(function (err) { list.innerHTML = emptyState(err.message || 'Could not load students.'); });
  }

  function setAttendanceStatus(studentId, status) {
    STATE.attendance.statuses[studentId] = status;
    var row = Array.prototype.find.call(document.querySelectorAll('#attendance-student-list .attendance-row'), function (r) { return r.dataset.studentId === studentId; });
    if (!row) return;
    row.querySelectorAll('.status-btn').forEach(function (b) { b.classList.toggle('selected', b.dataset.status === status); });
  }

  function saveAttendance() {
    var ids = Object.keys(STATE.attendance.statuses);
    if (!ids.length) return toast('No students to save attendance for.', 'error');
    var records = ids.map(function (id) { return { studentId: id, status: STATE.attendance.statuses[id] }; });
    submitWith($('save-attendance-btn'), 'Saving attendance...', 'Save Attendance', function () {
      return call('recordAttendance', STATE.attendance.date, STATE.attendance.className, records).then(reportResult);
    });
  }

  // ================= PAYMENTS =================
  function bindPaymentForm() {
    $('pay-date').value = todayInput();
    $('payment-student-search').addEventListener('input', function () { $('pay-student-id').value = ''; });
    $('payment-student-search').addEventListener('input', debounce(searchStudentsForPayment, 300));
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#payment-student-results') && e.target !== $('payment-student-search')) $('payment-student-results').classList.remove('open');
    });

    $('payment-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {
        studentId: $('pay-student-id').value,
        paymentType: $('pay-type').value,
        amount: $('pay-amount').value,
        academicYear: STATE.settings.ACADEMIC_YEAR,
        paymentDate: $('pay-date').value,
        paymentMethod: $('pay-method').value,
        reference: $('pay-reference').value
      };
      if (!data.studentId) return toast('Please search for and pick a student.', 'error');
      if (!(parseFloat(data.amount) > 0)) return toast('Please enter a valid payment amount.', 'error');
      submitWith($('payment-submit-btn'), 'Recording payment...', 'Record Payment', function () {
        return call('recordPayment', data).then(function (res) {
          if (!reportResult(res)) return;
          $('payment-form').reset();
          $('pay-date').value = todayInput();
          $('pay-student-id').value = '';
          loadPayments();
        });
      });
    });
    $('payments-filter-class').addEventListener('change', loadPayments);
    $('payments-filter-type').addEventListener('change', loadPayments);
  }

  function searchStudentsForPayment() {
    var term = $('payment-student-search').value.trim();
    var box = $('payment-student-results');
    if (!term || $('pay-student-id').value) { box.classList.remove('open'); box.innerHTML = ''; return; }
    call('getStudents', { search: term }).then(function (students) {
      box.innerHTML = students.length ? students.slice(0, 8).map(function (s) {
        var name = s.FIRST_NAME + ' ' + s.LAST_NAME;
        return '<div class="attendance-row"' + attr('data-action', 'pick-payment-student') + attr('data-id', s.STUDENT_ID) + attr('data-name', name) + '>' +
          '<div>' + escapeHtml(name) + '<div class="muted">' + escapeHtml(s.STUDENT_ID) + ' &middot; ' + escapeHtml(s.CLASS) + '</div></div></div>';
      }).join('') : '<div class="empty-state" style="padding:10px;">No students found.</div>';
      box.classList.add('open');
    }).catch(errorToast);
  }

  function selectPaymentStudent(studentId, name) {
    $('pay-student-id').value = studentId;
    $('payment-student-search').value = name + ' (' + studentId + ')';
    $('payment-student-results').classList.remove('open');
    $('payment-student-results').innerHTML = '';
  }

  function loadPayments() {
    var filters = { className: $('payments-filter-class').value, paymentType: $('payments-filter-type').value };
    var tbody = $('payments-table-body');
    tbody.innerHTML = loadingRow(7, 'Loading payments...');
    call('getPayments', filters).then(function (payments) {
      if (!payments.length) { tbody.innerHTML = '<tr><td colspan="7">' + emptyState('No payments recorded yet.') + '</td></tr>'; return; }
      tbody.innerHTML = payments.map(function (p) {
        return '<tr>' +
          '<td data-label="Student">' + escapeHtml(p.STUDENT_NAME) + '<div class="muted">' + escapeHtml(p.STUDENT_ID) + '</div></td>' +
          '<td data-label="Type">' + escapeHtml(p.PAYMENT_TYPE) + '</td>' +
          '<td data-label="Amount"><strong>' + formatCurrency(p.AMOUNT) + '</strong></td>' +
          '<td data-label="Method">' + escapeHtml(p.PAYMENT_METHOD) + '</td>' +
          '<td data-label="Date">' + formatDate(p.PAYMENT_DATE) + '</td>' +
          '<td data-label="Recorded By">' + escapeHtml(p.RECORDED_BY) + '</td>' +
          '<td data-label="Actions">' + actionButton('Receipt', 'receipt', { id: p.PAYMENT_ID }) + '</td>' +
          '</tr>';
      }).join('');
    }).catch(function (err) { tbody.innerHTML = '<tr><td colspan="7">' + emptyState(err.message || 'Could not load payments.') + '</td></tr>'; });
  }

  // ================= ANNOUNCEMENTS =================
  function bindAnnouncementForm() {
    $('new-announcement-btn').addEventListener('click', function () {
      $('announcement-form').reset();
      $('af-editing-id').value = '';
      $('af-date').value = todayInput();
      $('announcement-modal-title').textContent = 'New Announcement';
      toggleAnnouncementClassField();
      openModal('announcement-modal');
    });
    $('af-audience').addEventListener('change', toggleAnnouncementClassField);
    $('announcement-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var id = $('af-editing-id').value;
      var data = {
        title: $('af-title').value, message: $('af-message').value, audience: $('af-audience').value,
        className: $('af-class').value, date: $('af-date').value
      };
      if (!data.title.trim() || !data.message.trim()) return toast('Please fill in the title and message.', 'error');
      submitWith($('announcement-submit-btn'), 'Saving...', 'Save Announcement', function () {
        var req = id ? call('updateAnnouncement', Object.assign({ announcementId: id }, data)) : call('createAnnouncement', data);
        return req.then(function (res) {
          if (!reportResult(res)) return;
          closeModal('announcement-modal');
          loadAnnouncements();
        });
      });
    });
  }

  function toggleAnnouncementClassField() {
    $('af-class-group').classList.toggle('hidden', $('af-audience').value !== 'Specific Class');
  }

  function loadAnnouncements() {
    var list = $('announcements-list');
    list.innerHTML = '<div class="empty-state"><span class="spinner dark"></span> Loading announcements...</div>';
    call('getAnnouncements', {}).then(function (items) {
      STATE.announcements = items || [];
      if (!STATE.announcements.length) { list.innerHTML = emptyState('No announcements yet.'); return; }
      list.innerHTML = STATE.announcements.map(function (a) {
        var published = a.STATUS === 'PUBLISHED';
        return '<div class="card" style="margin-bottom:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap;">' +
          '<div><h3 style="font-size:15px;">' + escapeHtml(a.TITLE) + '</h3>' +
          '<div class="muted" style="margin-bottom:8px;">' + formatDate(a.DATE) + ' &middot; ' + escapeHtml(a.AUDIENCE) + (a.CLASS_NAME ? ' (' + escapeHtml(a.CLASS_NAME) + ')' : '') + '</div></div>' +
          '<span class="badge ' + (published ? 'badge-green' : 'badge-gray') + '">' + escapeHtml(a.STATUS) + '</span></div>' +
          '<p style="margin:6px 0 12px;white-space:pre-wrap;">' + escapeHtml(a.MESSAGE) + '</p>' +
          '<div class="quick-actions">' +
          actionButton('Edit', 'ann-edit', { id: a.ANNOUNCEMENT_ID }) +
          actionButton(published ? 'Unpublish' : 'Publish', 'ann-toggle', { id: a.ANNOUNCEMENT_ID, status: published ? 'UNPUBLISHED' : 'PUBLISHED' }) +
          (roleAtLeast('ADMIN') ? actionButton('Delete', 'ann-delete', { id: a.ANNOUNCEMENT_ID }, 'btn-danger') : '') +
          '</div></div>';
      }).join('');
    }).catch(function (err) { list.innerHTML = emptyState(err.message || 'Could not load announcements.'); });
  }

  function editAnnouncement(id) {
    var a = STATE.announcements.filter(function (x) { return x.ANNOUNCEMENT_ID === id; })[0];
    if (!a) return;
    $('announcement-modal-title').textContent = 'Edit Announcement';
    $('af-editing-id').value = a.ANNOUNCEMENT_ID;
    $('af-title').value = a.TITLE;
    $('af-message').value = a.MESSAGE;
    $('af-audience').value = a.AUDIENCE;
    $('af-class').value = a.CLASS_NAME || '';
    $('af-date').value = toDateInputValue(a.DATE);
    toggleAnnouncementClassField();
    openModal('announcement-modal');
  }

  function togglePublishAnnouncement(id, status) {
    call('setAnnouncementStatus', id, status).then(function (res) { if (reportResult(res)) loadAnnouncements(); }).catch(errorToast);
  }

  function removeAnnouncement(id) {
    if (!confirm('Delete this announcement? This cannot be undone.')) return;
    call('deleteAnnouncement', id).then(function (res) { if (reportResult(res)) loadAnnouncements(); }).catch(errorToast);
  }

  // ================= REPORTS =================
  function updateReportFilters() {
    var type = $('report-type').value;
    $('report-class-filter-group').style.display = ['STUDENT_LIST', 'CLASS_LIST', 'ATTENDANCE', 'PAYMENTS', 'REGISTRATION'].indexOf(type) !== -1 ? 'block' : 'none';
    $('report-date-filter-group').style.display = ['ATTENDANCE', 'PAYMENTS', 'REGISTRATION'].indexOf(type) !== -1 ? 'flex' : 'none';
  }

  function currentReportFilters() {
    return { className: $('report-class').value, startDate: $('report-start-date').value, endDate: $('report-end-date').value };
  }

  var HIDDEN_COLUMNS = ['_row', 'IS_DEMO', 'PHOTO_URL', 'MIDDLE_NAME', 'ATTENDANCE_ID', 'UPDATED_AT'];
  var MONEY_COLUMNS = ['AMOUNT', 'OUTSTANDING', 'PAID', 'EXPECTED_FEE'];

  function bindReportsUI() {
    $('report-type').addEventListener('change', updateReportFilters);
    updateReportFilters();
    $('report-generate-btn').addEventListener('click', function () {
      var results = $('report-results');
      results.innerHTML = '<div class="empty-state"><span class="spinner dark"></span> Generating report...</div>';
      call('generateReport', $('report-type').value, currentReportFilters()).then(function (res) {
        if (!res.success) { results.innerHTML = emptyState(res.message || 'Could not generate report.'); return; }
        var rows = res.rows || [];
        if (!rows.length) { results.innerHTML = emptyState('No data found for the selected filters.'); return; }
        var headers = Object.keys(rows[0]).filter(function (k) { return HIDDEN_COLUMNS.indexOf(k) === -1; });
        var html = '<h3 style="margin-bottom:12px;">' + escapeHtml(res.title) + ' (' + rows.length + ')</h3><div class="table-wrap"><table class="responsive-table"><thead><tr>' +
          headers.map(function (h) { return '<th>' + escapeHtml(h.replace(/_/g, ' ')) + '</th>'; }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (row) {
          html += '<tr>' + headers.map(function (h) {
            var val = row[h];
            if (MONEY_COLUMNS.indexOf(h) !== -1) val = formatCurrency(val);
            else if (/DATE|^DOB$|CREATED_AT|TIMESTAMP/.test(h)) val = formatDate(val);
            return '<td' + attr('data-label', h.replace(/_/g, ' ')) + '>' + escapeHtml(val) + '</td>';
          }).join('') + '</tr>';
        });
        results.innerHTML = html + '</tbody></table></div>';
      }).catch(function (err) { results.innerHTML = emptyState(err.message || 'Could not generate report.'); });
    });
    $('report-export-btn').addEventListener('click', function () {
      openPdf(Object.assign({ type: 'report', report: $('report-type').value }, currentReportFilters()));
    });
  }

  // ================= SETTINGS =================
  var SETTING_FIELDS = {
    SCHOOL_NAME: 'set-school-name', SCHOOL_MOTTO: 'set-school-motto', SCHOOL_EMAIL: 'set-school-email', SCHOOL_PHONE: 'set-school-phone',
    SCHOOL_ADDRESS: 'set-school-address', SCHOOL_LOGO_URL: 'set-school-logo', ACADEMIC_YEAR: 'set-academic-year', CURRENCY: 'set-currency',
    ADMIN_EMAIL: 'set-admin-email', TIMEZONE: 'set-timezone', STUDENT_ID_PREFIX: 'set-id-prefix', PRIMARY_COLOR: 'set-primary-color', ACCENT_COLOR: 'set-accent-color'
  };

  function bindSettingsUI() {
    document.querySelectorAll('.tab-btn[data-settings-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-settings-tab');
        document.querySelectorAll('.tab-btn[data-settings-tab]').forEach(function (b) { b.classList.toggle('active', b === btn); });
        document.querySelectorAll('.settings-tab').forEach(function (panel) { panel.classList.toggle('hidden', panel.id !== 'settings-tab-' + tab); });
      });
    });

    $('settings-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      Object.keys(SETTING_FIELDS).forEach(function (k) { data[k] = $(SETTING_FIELDS[k]).value; });
      data.ENABLED_MODULES = Array.prototype.filter.call(document.querySelectorAll('.module-toggle'), function (c) { return c.checked; })
        .map(function (c) { return c.value; }).join(',');
      submitWith($('settings-submit-btn'), 'Saving settings...', 'Save Settings', function () {
        return call('saveSettings', data).then(function (res) {
          if (!reportResult(res)) return;
          applySettings(res.settings);
        });
      });
    });

    $('class-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var data = { className: $('cf-name').value, expectedFee: $('cf-fee').value, academicYear: STATE.settings.ACADEMIC_YEAR };
      submitWith($('class-submit-btn'), 'Adding...', 'Add Class', function () {
        return call('addClass', data).then(function (res) {
          if (!reportResult(res)) return;
          $('class-form').reset();
          loadClassesTable();
          loadClasses();
        });
      });
    });

    $('admin-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var data = { name: $('adf-name').value, email: $('adf-email').value, role: $('adf-role').value };
      submitWith($('admin-submit-btn'), 'Adding...', 'Add Staff Member', function () {
        return call('addAdmin', data).then(function (res) {
          if (!reportResult(res)) return;
          $('admin-form').reset();
          loadAdminsTable();
        });
      });
    });
  }

  function loadSettingsPage() {
    call('getSettingsForClient').then(function (settings) {
      Object.keys(SETTING_FIELDS).forEach(function (k) { $(SETTING_FIELDS[k]).value = settings[k] || ''; });
      if (!/^#[0-9a-fA-F]{6}$/.test(settings.PRIMARY_COLOR || '')) $('set-primary-color').value = '#0F2A4A';
      if (!/^#[0-9a-fA-F]{6}$/.test(settings.ACCENT_COLOR || '')) $('set-accent-color').value = '#2FB8A3';
      var mods = String(settings.ENABLED_MODULES || '').split(',');
      document.querySelectorAll('.module-toggle').forEach(function (c) { c.checked = mods.indexOf(c.value) !== -1; });
    }).catch(errorToast);
    $('adf-role').querySelector('option[value="SUPER_ADMIN"]').disabled = !roleAtLeast('SUPER_ADMIN');
    loadClassesTable();
    loadAdminsTable();
  }

  function loadClassesTable() {
    var tbody = $('classes-table-body');
    tbody.innerHTML = loadingRow(3, 'Loading...');
    call('getClasses').then(function (classes) {
      tbody.innerHTML = classes.length ? classes.map(function (c) {
        return '<tr><td data-label="Class">' + escapeHtml(c.CLASS_NAME) + '</td><td data-label="Academic Year">' + escapeHtml(c.ACADEMIC_YEAR) +
          '</td><td data-label="Expected Fee">' + formatCurrency(c.EXPECTED_FEE) + '</td></tr>';
      }).join('') : '<tr><td colspan="3">' + emptyState('No classes yet. Add your first class.') + '</td></tr>';
    }).catch(function (err) { tbody.innerHTML = '<tr><td colspan="3">' + emptyState(err.message) + '</td></tr>'; });
  }

  function loadAdminsTable() {
    var tbody = $('admins-table-body');
    tbody.innerHTML = loadingRow(5, 'Loading...');
    call('getAdmins').then(function (admins) {
      tbody.innerHTML = admins.length ? admins.map(function (a) {
        var active = a.STATUS === 'ACTIVE';
        return '<tr><td data-label="Name">' + escapeHtml(a.NAME) + '</td><td data-label="Google account">' + escapeHtml(a.EMAIL) +
          '</td><td data-label="Role">' + escapeHtml(String(a.ROLE).replace('_', ' ')) + '</td><td data-label="Status">' + statusBadge(a.STATUS) + '</td>' +
          '<td data-label="Actions">' + actionButton(active ? 'Deactivate' : 'Activate', 'admin-toggle', { id: a.ID, status: active ? 'INACTIVE' : 'ACTIVE' }) + '</td></tr>';
      }).join('') : '<tr><td colspan="5">' + emptyState('No staff added yet.') + '</td></tr>';
    }).catch(function (err) { tbody.innerHTML = '<tr><td colspan="5">' + emptyState(err.message) + '</td></tr>'; });
  }

  function toggleAdminStatus(id, status) {
    call('setAdminStatus', id, status).then(function (res) { if (reportResult(res)) loadAdminsTable(); }).catch(errorToast);
  }
})();
