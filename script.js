/**
 * TaskList — script.js
 * ─────────────────────────────────────────────────────────────
 * Technology : Vanilla JavaScript (ES6+)
 * Storage    : Browser localStorage
 * Features   :
 *   • Full CRUD  (create, read, update, delete tasks)
 *   • Toggle task status: Active ↔ Completed
 *   • Dynamic filters: All | Active | Completed
 *   • Live statistics: Total | Active | Completed
 *   • LocalStorage persistence across page reloads
 *   • Empty-state UI
 *   • Form validation (empty input guard)
 *   • Toast notifications
 *   • Edit modal with title + notes
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

/* ============================================================
   1. CONSTANTS
   ============================================================ */

/** localStorage key for persisting tasks */
const STORAGE_KEY = 'tasklist_data';

/* ============================================================
   2. APPLICATION STATE
   ============================================================ */

/**
 * @typedef {Object} Task
 * @property {string}  id         - UUID
 * @property {string}  title      - Task title text
 * @property {string}  notes      - Optional notes
 * @property {boolean} completed  - Completion status
 * @property {number}  createdAt  - Unix timestamp (ms)
 */

/** @type {Task[]} Master task array (source of truth) */
let taskList = [];

/** @type {'all'|'active'|'completed'} Currently active filter */
let currentFilter = 'all';

/** @type {string|null} ID of the task being edited (null when modal is closed) */
let editingTaskId = null;

/* ============================================================
   3. DOM ELEMENT REFERENCES
   ============================================================ */

const DOM = {
  // Add-task form
  formAddTask:        document.getElementById('form-add-task'),
  inputTaskTitle:     document.getElementById('input-task-title'),
  errorEmptyTitle:    document.getElementById('error-empty-title'),

  // Filter buttons (NodeList)
  filterButtons:      document.querySelectorAll('.filter-btn'),

  // Task list & empty state
  taskListEl:         document.getElementById('task-list'),
  emptyState:         document.getElementById('empty-state'),
  emptyStateMsg:      document.getElementById('empty-state-msg'),

  // Header: clear completed
  btnClearCompleted:  document.getElementById('btn-clear-completed'),

  // Edit modal
  editModal:          document.getElementById('edit-modal'),
  editTaskTitle:      document.getElementById('edit-task-title'),
  editTaskNotes:      document.getElementById('edit-task-notes'),
  btnModalClose:      document.getElementById('btn-modal-close'),
  btnModalCancel:     document.getElementById('btn-modal-cancel'),
  btnModalSave:       document.getElementById('btn-modal-save'),

  // Toast container
  toastContainer:     document.getElementById('toast-container'),
};

/* ============================================================
   4. LOCAL STORAGE — Persistence helpers
   ============================================================ */

/**
 * Save the current taskList array to localStorage.
 */
function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(taskList));
}

/**
 * Load tasks from localStorage into taskList.
 * Falls back to an empty array if nothing is stored or JSON is corrupt.
 */
function loadTasks() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    taskList = stored ? JSON.parse(stored) : [];
  } catch (err) {
    // If JSON is corrupted, start fresh
    taskList = [];
  }
}

/* ============================================================
   5. TASK CRUD OPERATIONS
   ============================================================ */

/**
 * Create a new Task object.
 * @param {string} title
 * @returns {Task}
 */
function createTask(title) {
  return {
    id:        crypto.randomUUID(),
    title:     title.trim(),
    notes:     '',
    completed: false,
    createdAt: Date.now(),
  };
}

/**
 * Add a new task to the list, persist, and re-render.
 * @param {string} title
 */
function addTask(title) {
  const task = createTask(title);
  taskList.unshift(task);   // newest at the top
  saveTasks();
  renderAll();
  showToast('Task added!', 'success');
}

/**
 * Delete a task by ID with an exit animation.
 * @param {string} id
 */
function deleteTask(id) {
  // Animate the card out before removing from the array
  const cardEl = document.querySelector(`[data-task-id="${id}"]`);

  if (cardEl) {
    cardEl.classList.add('anim-task-leave');
    cardEl.addEventListener('animationend', () => {
      taskList = taskList.filter(t => t.id !== id);
      saveTasks();
      renderAll();
    }, { once: true });
  } else {
    taskList = taskList.filter(t => t.id !== id);
    saveTasks();
    renderAll();
  }

  showToast('Task deleted.', 'info');
}

/**
 * Toggle the completed status of a task.
 * @param {string} id
 */
function toggleTaskStatus(id) {
  const task = taskList.find(t => t.id === id);
  if (!task) return;

  task.completed = !task.completed;
  saveTasks();
  renderAll();
}

/**
 * Update a task's title and notes (called from the Edit modal).
 * @param {string} id
 * @param {string} newTitle
 * @param {string} newNotes
 */
function updateTask(id, newTitle, newNotes) {
  const task = taskList.find(t => t.id === id);
  if (!task) return;

  task.title = newTitle.trim();
  task.notes = newNotes.trim();
  saveTasks();
  renderAll();
  showToast('Task updated!', 'success');
}

/**
 * Remove every completed task from the list.
 */
function clearCompletedTasks() {
  const completedCount = taskList.filter(t => t.completed).length;

  if (completedCount === 0) {
    showToast('No completed tasks to clear.', 'info');
    return;
  }

  taskList = taskList.filter(t => !t.completed);
  saveTasks();
  renderAll();
  showToast(`Cleared ${completedCount} completed task${completedCount !== 1 ? 's' : ''}.`, 'info');
}

/* ============================================================
   6. FILTERING
   ============================================================ */

/**
 * Return the subset of tasks that match currentFilter.
 * @returns {Task[]}
 */
function getFilteredTasks() {
  switch (currentFilter) {
    case 'active':    return taskList.filter(t => !t.completed);
    case 'completed': return taskList.filter(t => t.completed);
    default:          return taskList;          // 'all'
  }
}

/* ============================================================
   7. RENDER — STATISTICS
   ============================================================ */

/**
 * Build and inject the three stat cards (Total, Active, Completed).
 * Called on every state change so numbers stay accurate.
 */
/* ============================================================
   7 + 8. RENDER — FILTER BUTTONS WITH COUNTS
   Task statistics are displayed directly inside each filter tab:
     All (n)  ·  Active (n)  ·  Completed (n)
   This reuses the same total/active/completed calculation that
   previously powered the separate stat cards — no duplication.
   ============================================================ */

/**
 * Calculate current task counts and update each filter button's
 * label to include the matching count, e.g. "All (10)".
 * Also syncs the active/inactive visual state of each button.
 */
function renderFilterButtons() {
  // Single source-of-truth calculation (replaces renderStats)
  const total     = taskList.length;
  const completed = taskList.filter(t => t.completed).length;
  const active    = total - completed;

  // Map each filter value to its count
  const counts = { all: total, active, completed };

  // Label text for each filter (title-cased)
  const labels = { all: 'All', active: 'Active', completed: 'Completed' };

  DOM.filterButtons.forEach(btn => {
    const filter   = btn.dataset.filter;
    const isActive = filter === currentFilter;
    const count    = counts[filter];

    // Rebuild the button's inner HTML: label + count pill
    btn.innerHTML = `
      ${labels[filter]}
      <span class="filter-count">${count}</span>
    `;

    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
    btn.setAttribute('aria-label', `${labels[filter]}: ${count} task${count !== 1 ? 's' : ''}`);
  });
}

/* ============================================================
   9. RENDER — TASK LIST
   ============================================================ */

/**
 * Build the SVG icon markup for the edit button.
 * @returns {string} SVG HTML string
 */
function editIconSVG() {
  return `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round"
      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
         m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
  </svg>`;
}

/**
 * Build the SVG icon markup for the delete button.
 * @returns {string} SVG HTML string
 */
function deleteIconSVG() {
  return `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round"
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
         a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6
         m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
  </svg>`;
}

/**
 * Build a single <li> task card DOM element for the given task.
 * Attaches its own event listeners for checkbox, edit, and delete.
 * @param {Task} task
 * @returns {HTMLLIElement}
 */
function buildTaskCard(task) {
  const li = document.createElement('li');
  li.className = `task-card anim-task-enter${task.completed ? ' is-completed' : ''}`;
  li.dataset.taskId = task.id;

  // Badge variant depends on status
  const badgeClass = task.completed ? 'badge-done' : 'badge-active';
  const badgeText  = task.completed ? 'Done' : 'Active';

  li.innerHTML = `
    <!-- Completion checkbox -->
    <input
      type="checkbox"
      class="task-checkbox"
      ${task.completed ? 'checked' : ''}
      aria-label="${task.completed ? 'Mark as active' : 'Mark as complete'}"
    />

    <!-- Task content -->
    <div class="flex-1 min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <span class="task-title">${escapeHtml(task.title)}</span>
        <span class="status-badge ${badgeClass}">${badgeText}</span>
      </div>
      ${task.notes
        ? `<p class="task-notes-text">${escapeHtml(task.notes)}</p>`
        : ''}
    </div>

    <!-- Action buttons -->
    <div class="flex items-center gap-1 flex-shrink-0">
      <button class="icon-btn btn-edit"   title="Edit task"   aria-label="Edit task">${editIconSVG()}</button>
      <button class="icon-btn btn-delete" title="Delete task" aria-label="Delete task">${deleteIconSVG()}</button>
    </div>
  `;

  // ── Attach events ────────────────────────────────────────────
  li.querySelector('.task-checkbox').addEventListener('change', () => toggleTaskStatus(task.id));
  li.querySelector('.btn-edit').addEventListener('click',  () => openEditModal(task.id));
  li.querySelector('.btn-delete').addEventListener('click', () => deleteTask(task.id));

  return li;
}

/**
 * Render the filtered task list into the DOM, or show the empty state.
 */
function renderTaskList() {
  const filtered = getFilteredTasks();

  // ── Empty state ──────────────────────────────────────────────
  if (filtered.length === 0) {
    DOM.taskListEl.innerHTML = '';

    // Context-sensitive empty message
    if (currentFilter === 'active') {
      DOM.emptyStateMsg.textContent = 'No active tasks — you\'re all caught up!';
    } else if (currentFilter === 'completed') {
      DOM.emptyStateMsg.textContent = 'No completed tasks yet.';
    } else {
      DOM.emptyStateMsg.textContent = 'No tasks yet — add one above!';
    }

    DOM.emptyState.classList.remove('hidden');
    return;
  }

  // ── Task cards ───────────────────────────────────────────────
  DOM.emptyState.classList.add('hidden');

  const fragment = document.createDocumentFragment();
  filtered.forEach(task => fragment.appendChild(buildTaskCard(task)));

  DOM.taskListEl.innerHTML = '';
  DOM.taskListEl.appendChild(fragment);
}

/* ============================================================
   10. RENDER — MASTER FUNCTION
   ============================================================ */

/**
 * Re-render all dynamic UI sections: stats, filters, task list.
 * Call this after any state change.
 */
function renderAll() {
  renderFilterButtons();  // counts + active state (replaces separate renderStats)
  renderTaskList();
}

/* ============================================================
   11. EDIT MODAL
   ============================================================ */

/**
 * Open the edit modal and populate it with the task's current data.
 * @param {string} id  Task ID to edit
 */
function openEditModal(id) {
  const task = taskList.find(t => t.id === id);
  if (!task) return;

  editingTaskId = id;
  DOM.editTaskTitle.value = task.title;
  DOM.editTaskNotes.value = task.notes || '';

  // Show the modal
  DOM.editModal.classList.remove('hidden');
  DOM.editTaskTitle.focus();
}

/**
 * Close the edit modal and clear the editing state.
 */
function closeEditModal() {
  DOM.editModal.classList.add('hidden');
  editingTaskId = null;
}

/**
 * Validate and save the edit modal form, then close.
 */
function saveEditModal() {
  const newTitle = DOM.editTaskTitle.value.trim();

  // Guard: title must not be empty
  if (!newTitle) {
    DOM.editTaskTitle.focus();
    showToast('Task title cannot be empty.', 'error');
    return;
  }

  updateTask(editingTaskId, newTitle, DOM.editTaskNotes.value);
  closeEditModal();
}

/* ============================================================
   12. FORM — Add task
   ============================================================ */

/**
 * Handle the add-task form submission.
 * Validates that the input is non-empty before creating a task.
 * Triggered by both button click and Enter key (form submit).
 * @param {SubmitEvent} event
 */
function handleAddTask(event) {
  event.preventDefault();

  const title = DOM.inputTaskTitle.value.trim();

  // Validation: empty input
  if (!title) {
    DOM.errorEmptyTitle.classList.remove('hidden');
    DOM.inputTaskTitle.focus();
    return;
  }

  // Clear error if previously shown
  DOM.errorEmptyTitle.classList.add('hidden');

  addTask(title);

  // Reset input field and return focus for quick sequential entry
  DOM.inputTaskTitle.value = '';
  DOM.inputTaskTitle.focus();
}

/* ============================================================
   13. TOAST NOTIFICATIONS
   ============================================================ */

// SVG icons for toast types
const TOAST_ICONS = {
  success: `<svg class="w-4 h-4 text-green-400 flex-shrink-0" fill="none" stroke="currentColor"
               stroke-width="2.5" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
             </svg>`,
  error:   `<svg class="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor"
               stroke-width="2.5" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
             </svg>`,
  info:    `<svg class="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor"
               stroke-width="2.5" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round"
                 d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
             </svg>`,
};

/**
 * Display a temporary toast notification.
 * @param {string} message  Text to display
 * @param {'success'|'error'|'info'} type
 */
function showToast(message, type = 'info') {
  const toastEl = document.createElement('div');
  toastEl.className = `toast toast-${type}`;
  toastEl.innerHTML = `
    ${TOAST_ICONS[type] || TOAST_ICONS.info}
    <span>${escapeHtml(message)}</span>
  `;

  DOM.toastContainer.appendChild(toastEl);

  // Auto-dismiss after 3 seconds with a fade-out
  setTimeout(() => {
    toastEl.style.transition = 'opacity 0.3s ease';
    toastEl.style.opacity = '0';
    setTimeout(() => toastEl.remove(), 320);
  }, 3000);
}

/* ============================================================
   14. UTILITY FUNCTIONS
   ============================================================ */

/**
 * Escape user-provided text to prevent XSS when inserting as innerHTML.
 * @param {string} str
 * @returns {string} HTML-escaped string
 */
function escapeHtml(str) {
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

/* ============================================================
   15. EVENT LISTENERS
   ============================================================ */

/**
 * Attach all global event listeners.
 * Runs once during initialisation.
 */
function attachEventListeners() {

  // ── Add-task form (handles Enter key + button click) ──────────
  DOM.formAddTask.addEventListener('submit', handleAddTask);

  // Clear inline validation error as the user types
  DOM.inputTaskTitle.addEventListener('input', () => {
    if (!DOM.errorEmptyTitle.classList.contains('hidden')) {
      DOM.errorEmptyTitle.classList.add('hidden');
    }
  });

  // ── Filter buttons ─────────────────────────────────────────────
  DOM.filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;  // 'all' | 'active' | 'completed'
      renderAll();
    });
  });

  // ── Header: clear completed tasks ─────────────────────────────
  DOM.btnClearCompleted.addEventListener('click', clearCompletedTasks);

  // ── Edit modal controls ───────────────────────────────────────
  DOM.btnModalClose.addEventListener('click',  closeEditModal);
  DOM.btnModalCancel.addEventListener('click', closeEditModal);
  DOM.btnModalSave.addEventListener('click',   saveEditModal);

  // Close modal when clicking the backdrop (outside the panel)
  DOM.editModal.addEventListener('click', event => {
    if (event.target === DOM.editModal) closeEditModal();
  });

  // ── Keyboard shortcuts ────────────────────────────────────────
  document.addEventListener('keydown', event => {
    // Escape → close modal
    if (event.key === 'Escape' && !DOM.editModal.classList.contains('hidden')) {
      closeEditModal();
    }

    // Ctrl/Cmd + Enter inside modal → save
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      if (!DOM.editModal.classList.contains('hidden')) {
        saveEditModal();
      }
    }
  });

  // Enter key on the title field in the modal saves immediately
  DOM.editTaskTitle.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveEditModal();
    }
  });
}

/* ============================================================
   16. INITIALISATION
   ============================================================ */

/**
 * Bootstrap the application:
 *  1. Load tasks from localStorage
 *  2. Attach all event listeners
 *  3. Render initial UI
 */
function init() {
  loadTasks();
  attachEventListeners();
  renderAll();
}

// Run when the DOM is fully parsed
document.addEventListener('DOMContentLoaded', init);
