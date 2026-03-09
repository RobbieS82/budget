/* ============================================================
   Budget App – Application Logic
   ============================================================ */

'use strict';

// ── Constants ─────────────────────────────────────────────

const STORAGE_KEY = 'budgetApp_v1';

// ── State ─────────────────────────────────────────────────

let state = {
  bankBalance: 0,
  items: []          // { id, day, description, amount, active }
};

// ── Persistence ───────────────────────────────────────────

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    showToast('Could not save to local storage.', 'error');
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Validate minimal shape
      if (typeof parsed.bankBalance === 'number' && Array.isArray(parsed.items)) {
        state = parsed;
        // Back-fill any missing fields introduced in later versions
        state.items = state.items.map(normalizeItem);
      }
    }
  } catch (e) {
    showToast('Could not load saved data.', 'error');
  }
}

function normalizeItem(item) {
  return {
    id:          item.id          || generateId(),
    day:         Number(item.day) || 1,
    description: item.description || '',
    amount:      Number(item.amount) || 0,
    active:      item.active !== undefined ? Boolean(item.active) : true
  };
}

// ── ID Generation ─────────────────────────────────────────

function generateId() {
  return 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ── Balance Calculation ───────────────────────────────────

/**
 * Returns an array parallel to state.items where each element is the
 * projected bank balance AFTER that item (only active items contribute).
 */
function calcRunningBalances() {
  let running = state.bankBalance;
  return state.items.map(item => {
    if (item.active) {
      running += item.amount;
    }
    return running;
  });
}

// ── Formatting ────────────────────────────────────────────

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(value);
}

function parseCurrency(str) {
  // Strip everything except digits, minus sign, and decimal point
  const cleaned = String(str).replace(/[^0-9.\-]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

// ── Render ────────────────────────────────────────────────

function render() {
  renderBankBalance();
  renderTable();
}

function renderBankBalance() {
  const input = document.getElementById('bank-balance');
  if (document.activeElement !== input) {
    input.value = state.bankBalance.toFixed(2);
  }
}

function renderTable() {
  const tbody = document.getElementById('items-tbody');
  const balances = calcRunningBalances();

  if (state.items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <div class="icon">💰</div>
            <p>No budget items yet. Add one below!</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = '';
  state.items.forEach((item, idx) => {
    const balance = balances[idx];
    const row = document.createElement('tr');
    row.dataset.id = item.id;
    row.draggable = true;
    if (!item.active) row.classList.add('inactive');

    const amtClass = item.amount >= 0 ? 'amount-positive' : 'amount-negative';
    const balClass = balance >= 0 ? 'balance-positive' : 'balance-negative';

    row.innerHTML = `
      <td class="col-drag">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
      </td>
      <td class="col-active">
        <input type="checkbox" class="active-toggle"
               aria-label="Include in balance calculation"
               ${item.active ? 'checked' : ''}>
      </td>
      <td class="col-day">${escapeHtml(String(item.day))}</td>
      <td class="col-desc">${escapeHtml(item.description)}</td>
      <td class="col-amount ${amtClass}">${formatCurrency(item.amount)}</td>
      <td class="col-balance balance-cell ${balClass}">${formatCurrency(balance)}</td>
      <td class="col-actions">
        <button class="btn-ghost btn-icon btn-edit" title="Edit" aria-label="Edit item">✏️</button>
        <button class="btn-ghost btn-icon btn-delete" title="Delete" aria-label="Delete item">🗑️</button>
      </td>`;

    // Wire up row-level events
    row.querySelector('.active-toggle').addEventListener('change', e => {
      toggleActive(item.id, e.target.checked);
    });
    row.querySelector('.btn-edit').addEventListener('click', () => openEditModal(item.id));
    row.querySelector('.btn-delete').addEventListener('click', () => confirmDelete(item.id));

    // Drag-and-drop
    row.addEventListener('dragstart', onDragStart);
    row.addEventListener('dragover',  onDragOver);
    row.addEventListener('dragleave', onDragLeave);
    row.addEventListener('drop',      onDrop);
    row.addEventListener('dragend',   onDragEnd);

    tbody.appendChild(row);
  });
}

// ── Escape HTML ───────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── CRUD ──────────────────────────────────────────────────

function addItem({ day, description, amount }) {
  const item = normalizeItem({ day, description, amount, active: true });
  state.items.push(item);
  saveState();
  render();
  showToast('Item added.', 'success');
}

function updateItem(id, { day, description, amount }) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  item.day         = Number(day)  || item.day;
  item.description = description  || item.description;
  item.amount      = amount;       // already a number from parseCurrency + validateItemInputs
  saveState();
  render();
  showToast('Item updated.', 'success');
}

function deleteItem(id) {
  state.items = state.items.filter(i => i.id !== id);
  saveState();
  render();
  showToast('Item deleted.');
}

function toggleActive(id, active) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  item.active = active;
  saveState();
  render();
}

// ── Drag-and-Drop Reordering ──────────────────────────────

let dragSrcId = null;

function onDragStart(e) {
  dragSrcId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  // Required for Firefox
  e.dataTransfer.setData('text/plain', dragSrcId);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.currentTarget;
  if (row.dataset.id !== dragSrcId) {
    row.classList.add('drag-over');
  }
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  const targetId = e.currentTarget.dataset.id;
  e.currentTarget.classList.remove('drag-over');
  if (!dragSrcId || dragSrcId === targetId) return;

  const srcIdx  = state.items.findIndex(i => i.id === dragSrcId);
  const tgtIdx  = state.items.findIndex(i => i.id === targetId);
  if (srcIdx === -1 || tgtIdx === -1) return;

  const [moved] = state.items.splice(srcIdx, 1);
  state.items.splice(tgtIdx, 0, moved);
  saveState();
  render();
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('#items-tbody tr').forEach(r => r.classList.remove('drag-over'));
  dragSrcId = null;
}

// ── Add-Item Form ─────────────────────────────────────────

function bindAddForm() {
  const form = document.getElementById('add-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const day   = parseInt(form.elements['day'].value, 10);
    const desc  = form.elements['description'].value.trim();
    const amount = parseCurrency(form.elements['amount'].value);

    if (!validateItemInputs(day, desc, form.elements['amount'].value)) return;

    addItem({ day, description: desc, amount });
    form.reset();
    form.elements['day'].focus();
  });
}

function validateItemInputs(day, desc, amountStr) {
  if (isNaN(day) || day < 1 || day > 31) {
    showToast('Day must be between 1 and 31.', 'error');
    return false;
  }
  if (!desc) {
    showToast('Description cannot be empty.', 'error');
    return false;
  }
  const amount = parseCurrency(amountStr);
  if (isNaN(amount)) {
    showToast('Please enter a valid dollar amount.', 'error');
    return false;
  }
  return true;
}

// ── Edit Modal ────────────────────────────────────────────

function openEditModal(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  const backdrop = document.getElementById('edit-modal-backdrop');
  backdrop.dataset.editId = id;
  backdrop.querySelector('#modal-day').value         = item.day;
  backdrop.querySelector('#modal-description').value = item.description;
  backdrop.querySelector('#modal-amount').value      = item.amount.toFixed(2);
  backdrop.classList.remove('hidden');
  backdrop.querySelector('#modal-day').focus();
}

function closeEditModal() {
  const backdrop = document.getElementById('edit-modal-backdrop');
  backdrop.classList.add('hidden');
  delete backdrop.dataset.editId;
}

function bindEditModal() {
  const backdrop = document.getElementById('edit-modal-backdrop');
  const form     = document.getElementById('edit-form');

  document.getElementById('modal-cancel').addEventListener('click', closeEditModal);

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closeEditModal();
  });

  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeEditModal();
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const id     = backdrop.dataset.editId;
    const day    = parseInt(form.elements['modal-day'].value, 10);
    const desc   = form.elements['modal-description'].value.trim();
    const amount = parseCurrency(form.elements['modal-amount'].value);

    if (!validateItemInputs(day, desc, form.elements['modal-amount'].value)) return;

    updateItem(id, { day, description: desc, amount });
    closeEditModal();
  });
}

// ── Delete Confirmation ───────────────────────────────────

function confirmDelete(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  if (window.confirm(`Delete "${item.description}"?`)) {
    deleteItem(id);
  }
}

// ── Bank Balance ──────────────────────────────────────────

function bindBankBalance() {
  const input = document.getElementById('bank-balance');

  input.addEventListener('change', () => {
    const val = parseCurrency(input.value);
    state.bankBalance = val;
    saveState();
    render();
  });

  input.addEventListener('blur', () => {
    input.value = state.bankBalance.toFixed(2);
  });
}

// ── Export / Import ───────────────────────────────────────

function exportJSON() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'budget.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Budget exported.', 'success');
}

function importJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (typeof parsed.bankBalance !== 'number' || !Array.isArray(parsed.items)) {
        showToast('Invalid budget file format.', 'error');
        return;
      }
      state = {
        bankBalance: parsed.bankBalance,
        items:       parsed.items.map(normalizeItem)
      };
      saveState();
      render();
      showToast('Budget imported successfully.', 'success');
    } catch {
      showToast('Could not parse JSON file.', 'error');
    }
  };
  reader.readAsText(file);
}

function bindImportExport() {
  document.getElementById('btn-export').addEventListener('click', exportJSON);

  const fileInput = document.getElementById('import-file');
  document.getElementById('btn-import').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) {
      importJSON(file);
      fileInput.value = '';   // reset so same file can be re-imported
    }
  });
}

// ── Toast ─────────────────────────────────────────────────

function showToast(message, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity .3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 350);
  }, 2800);
}

// ── Bootstrap ─────────────────────────────────────────────

function init() {
  loadState();
  bindBankBalance();
  bindAddForm();
  bindEditModal();
  bindImportExport();
  render();
}

document.addEventListener('DOMContentLoaded', init);
