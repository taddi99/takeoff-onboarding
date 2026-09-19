/* Shared helpers used by every page. Kept dependency-free on purpose. */

const API_BASE = '/api';

const Session = {
  get token() { return localStorage.getItem('takeoff_token'); },
  set token(v) { v ? localStorage.setItem('takeoff_token', v) : localStorage.removeItem('takeoff_token'); },
  get user() {
    try { return JSON.parse(localStorage.getItem('takeoff_user') || 'null'); }
    catch { return null; }
  },
  set user(v) { v ? localStorage.setItem('takeoff_user', JSON.stringify(v)) : localStorage.removeItem('takeoff_user'); },
  clear() { this.token = null; this.user = null; },
  isLoggedIn() { return !!this.token && !!this.user; }
};

async function api(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  if (Session.token) headers['Authorization'] = `Bearer ${Session.token}`;
  if (!isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined
  });

  let data = null;
  try { data = await res.json(); } catch { /* no body */ }

  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function showAlert(el, message, type = 'error') {
  if (!el) return;
  el.textContent = message;
  el.className = `alert alert-${type} show`;
}
function hideAlert(el) {
  if (!el) return;
  el.className = 'alert';
}

function requireLogin(redirectTo = '/index.html') {
  if (!Session.isLoggedIn()) window.location.href = redirectTo;
}
function requireRole(role, redirectTo = '/index.html') {
  requireLogin(redirectTo);
  if (Session.user?.role !== role) window.location.href = redirectTo;
}

function logout() {
  Session.clear();
  window.location.href = '/index.html';
}

function statusBadge(status) {
  const labels = {
    draft: 'Draft', submitted: 'Submitted', under_review: 'Under review',
    approved: 'Approved', rejected: 'Rejected'
  };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
