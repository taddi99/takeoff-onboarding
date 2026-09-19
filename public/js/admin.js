/**
 * Admin / Reviewer Dashboard controller.
 * Split out from admin.html so the page markup stays simple and this file
 * can grow (stats, search, audit log, export) without turning the HTML
 * into an unreadable wall of inline script.
 */

requireRole('admin');

const AdminDashboard = (() => {
  let currentFilter = '';
  let currentSearch = '';
  let currentUserId = null;
  let searchDebounceTimer = null;

  const els = {};

  function cacheEls() {
    els.whoName = document.getElementById('whoName');
    els.alert = document.getElementById('alert');
    els.statCards = document.getElementById('statCards');
    els.filterBar = document.getElementById('filterBar');
    els.searchInput = document.getElementById('searchInput');
    els.exportBtn = document.getElementById('exportBtn');
    els.tabApplications = document.getElementById('tabApplications');
    els.tabAuditLog = document.getElementById('tabAuditLog');
    els.applicationsPanel = document.getElementById('applicationsPanel');
    els.auditPanel = document.getElementById('auditPanel');
    els.appTbody = document.getElementById('appTbody');
    els.emptyState = document.getElementById('emptyState');
    els.auditTbody = document.getElementById('auditTbody');
    els.auditEmptyState = document.getElementById('auditEmptyState');
    els.detailCard = document.getElementById('detailCard');
    els.dName = document.getElementById('dName');
    els.dContact = document.getElementById('dContact');
    els.dStatusBadge = document.getElementById('dStatusBadge');
    els.dBody = document.getElementById('dBody');
    els.notes = document.getElementById('notes');
    els.markReviewBtn = document.getElementById('markReviewBtn');
    els.approveBtn = document.getElementById('approveBtn');
    els.rejectBtn = document.getElementById('rejectBtn');
    els.closeDetailBtn = document.getElementById('closeDetailBtn');
  }

  // ---- Stats ----
  async function loadStats() {
    try {
      const data = await api('/admin/stats');
      const cards = [
        { label: 'Submitted', value: data.counts.submitted, tone: 'submitted' },
        { label: 'Under review', value: data.counts.under_review, tone: 'under_review' },
        { label: 'Approved', value: data.counts.approved, tone: 'approved' },
        { label: 'Rejected', value: data.counts.rejected, tone: 'rejected' },
        { label: 'Draft', value: data.counts.draft, tone: 'draft' },
        { label: 'Decisions (7d)', value: data.decisionsLast7Days, tone: 'neutral' }
      ];
      els.statCards.innerHTML = cards.map((c) => `
        <div class="stat-card stat-${c.tone}">
          <div class="stat-value">${c.value}</div>
          <div class="stat-label">${c.label}</div>
        </div>
      `).join('');
    } catch (err) {
      // Stats are a nice-to-have; don't block the rest of the dashboard on a failure.
      console.error('stats load failed:', err.message);
    }
  }

  // ---- Applications list ----
  async function loadList() {
    hideAlert(els.alert);
    try {
      const params = new URLSearchParams();
      if (currentFilter) params.set('status', currentFilter);
      if (currentSearch) params.set('q', currentSearch);
      const qs = params.toString() ? `?${params.toString()}` : '';

      const data = await api(`/admin/applications${qs}`);
      const rows = data.applications || [];
      els.emptyState.style.display = rows.length ? 'none' : 'block';
      els.appTbody.innerHTML = rows.map((r) => `
        <tr>
          <td>${escapeHtml(r.full_name)}</td>
          <td>${escapeHtml(r.email)}</td>
          <td>${escapeHtml(r.phone)}</td>
          <td>${statusBadge(r.status)}</td>
          <td>${formatDate(r.submitted_at)}</td>
          <td><button class="btn-secondary" data-open-detail="${r.user_id}">Review</button></td>
        </tr>
      `).join('');
    } catch (err) {
      showAlert(els.alert, err.message);
    }
  }

  // ---- Audit log ----
  async function loadAuditLog() {
    hideAlert(els.alert);
    try {
      const data = await api('/admin/audit-log?limit=100');
      const entries = data.entries || [];
      els.auditEmptyState.style.display = entries.length ? 'none' : 'block';
      els.auditTbody.innerHTML = entries.map((e) => `
        <tr>
          <td>${formatDate(e.created_at)}</td>
          <td>${escapeHtml(e.actor_name || 'System')} <span class="muted">(${e.actor_role || '—'})</span></td>
          <td>${actionLabel(e.action)}</td>
          <td>${escapeHtml(e.target_name || (e.target_id ? `#${e.target_id}` : '—'))}</td>
          <td class="muted">${escapeHtml(e.details || '')}</td>
        </tr>
      `).join('');
    } catch (err) {
      showAlert(els.alert, err.message);
    }
  }

  function actionLabel(action) {
    const labels = {
      application_submitted: 'Application submitted',
      application_approved: 'Application approved',
      application_rejected: 'Application rejected',
      applications_exported: 'Exported applications (CSV)'
    };
    return labels[action] || action;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Detail / review panel ----
  async function openDetail(userId) {
    hideAlert(els.alert);
    currentUserId = userId;
    try {
      const data = await api(`/admin/applications/${userId}`);
      const d = data.driver, p = data.profile || {}, i = data.identity || {}, v = data.vehicle || {};
      const app = data.application || { status: 'draft' };

      els.dName.textContent = d.full_name;
      els.dContact.textContent = `${d.email} · ${d.phone} · Phone verified: ${d.phone_verified ? 'Yes' : 'No'}`;
      els.dStatusBadge.innerHTML = statusBadge(app.status);

      els.dBody.innerHTML = `
        <h3>Personal</h3>
        <p class="muted">DOB: ${p.date_of_birth ? p.date_of_birth.slice(0, 10) : '—'} · Gender: ${p.gender || '—'}</p>
        <p class="muted">${escapeHtml(p.address_line1 || '')} ${escapeHtml(p.address_line2 || '')}, ${escapeHtml(p.city || '')}, ${escapeHtml(p.state || '')} ${escapeHtml(p.postal_code || '')}</p>
        <p class="muted">Emergency contact: ${escapeHtml(p.emergency_contact_name || '—')} (${escapeHtml(p.emergency_contact_phone || '—')})</p>
        <h3>Identity</h3>
        <p class="muted">${(i.id_type || '—').replace('_', ' ')} — ${escapeHtml(i.id_number || '—')} ${i.expiry_date ? '· Expires ' + i.expiry_date.slice(0, 10) : ''}</p>
        <h3>Vehicle</h3>
        <p class="muted">${v.year || ''} ${escapeHtml(v.make || '')} ${escapeHtml(v.model || '')} (${v.vehicle_type || ''}) · Plate ${escapeHtml(v.plate_number || '—')} · Seats ${v.seating_capacity || '—'}</p>
        <h3>Documents</h3>
        <div class="doc-grid">
          ${(data.documents || []).map((doc) => `
            <div class="doc-tile filled">
              <strong>${doc.doc_type.replace('_', ' ')}</strong>
              <div class="muted">${escapeHtml(doc.original_name)}</div>
              <a href="/api/admin/documents/${doc.id}/file" target="_blank" rel="noopener">
                <button class="btn-secondary" style="margin-top:8px; width:100%;" type="button">View file</button>
              </a>
            </div>
          `).join('') || '<p class="muted">No documents uploaded.</p>'}
        </div>
      `;

      els.notes.value = app.review_notes || '';
      const decidable = ['submitted', 'under_review'].includes(app.status);
      els.approveBtn.disabled = !decidable;
      els.rejectBtn.disabled = !decidable;
      els.markReviewBtn.disabled = app.status !== 'submitted';

      els.detailCard.style.display = 'block';
      els.detailCard.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      showAlert(els.alert, err.message);
    }
  }

  async function markUnderReview() {
    try {
      await api(`/admin/applications/${currentUserId}/mark-review`, { method: 'POST' });
      await openDetail(currentUserId);
      await Promise.all([loadList(), loadStats()]);
    } catch (err) { showAlert(els.alert, err.message); }
  }

  async function decide(decision) {
    const notes = els.notes.value.trim();
    const confirmMsg = decision === 'rejected'
      ? 'Reject this application? The driver will see your notes.'
      : 'Approve this application?';
    if (!confirm(confirmMsg)) return;

    try {
      await api(`/admin/applications/${currentUserId}/decision`, { method: 'POST', body: { decision, notes } });
      await openDetail(currentUserId);
      await Promise.all([loadList(), loadStats(), loadAuditLog()]);
    } catch (err) { showAlert(els.alert, err.message); }
  }

  // ---- Tabs ----
  function showTab(tab) {
    const isApps = tab === 'applications';
    els.applicationsPanel.style.display = isApps ? 'block' : 'none';
    els.auditPanel.style.display = isApps ? 'none' : 'block';
    els.tabApplications.classList.toggle('active', isApps);
    els.tabAuditLog.classList.toggle('active', !isApps);
    if (!isApps) loadAuditLog();
  }

  // ---- CSV export ----
  async function downloadCsv(params) {
    hideAlert(els.alert);
    try {
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/admin/applications/export${qs}`, {
        headers: { Authorization: `Bearer ${Session.token}` }
      });
      if (!res.ok) throw new Error('Export failed.');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `applications-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      showAlert(els.alert, err.message || 'Could not export applications.');
    }
  }

  function currentParams() {
    const params = new URLSearchParams();
    if (currentFilter) params.set('status', currentFilter);
    if (currentSearch) params.set('q', currentSearch);
    return params;
  }

  // ---- Wiring ----
  function bindEvents() {
    els.filterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-status]');
      if (!btn) return;
      document.querySelectorAll('#filterBar button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.status;
      loadList();
    });

    els.searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        currentSearch = e.target.value.trim();
        loadList();
      }, 300);
    });

    els.appTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-open-detail]');
      if (!btn) return;
      openDetail(Number(btn.dataset.openDetail));
    });

    els.exportBtn.addEventListener('click', () => downloadCsv(currentParams()));

    els.tabApplications.addEventListener('click', () => showTab('applications'));
    els.tabAuditLog.addEventListener('click', () => showTab('audit'));

    els.closeDetailBtn.addEventListener('click', () => {
      els.detailCard.style.display = 'none';
      currentUserId = null;
    });
    els.markReviewBtn.addEventListener('click', markUnderReview);
    els.approveBtn.addEventListener('click', () => decide('approved'));
    els.rejectBtn.addEventListener('click', () => decide('rejected'));
  }

  function init() {
    cacheEls();
    els.whoName.textContent = Session.user.fullName;
    bindEvents();
    loadStats();
    loadList();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', AdminDashboard.init);
