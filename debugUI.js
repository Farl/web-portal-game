import { CONFIG } from "./config.js";

/**
 * DebugUI - Handles debug UI controls and visibility
 */
export class DebugUI {
  constructor() {
    this.debugUI = document.getElementById('debug-ui');
    this.debugSteps = { ...CONFIG.debug.defaultSteps };

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Toggle debug UI with "/" key
    window.addEventListener('keydown', (e) => {
      if (e.key === CONFIG.debug.toggleKey) {
        e.preventDefault();
        if (this.debugUI.style.display === 'none') {
          this.debugUI.style.display = 'block';
        } else {
          this.debugUI.style.display = 'none';
        }
      }
    });

    // Prevent pointer lock when interacting with debug UI
    this.debugUI.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    this.debugUI.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Setup checkboxes
    this.setupCheckbox('stepA', 'stepA');
    this.setupCheckbox('stepB', 'stepB');
    this.setupCheckbox('step0', 'step0');
    this.setupCheckbox('step1a', 'step1a');
    this.setupCheckbox('step1b', 'step1b');
    this.setupCheckbox('step2', 'step2');
    this.setupCheckbox('step3', 'step3');

    // ESC key handler
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.debugUI.classList.contains('hidden')) {
          this.debugUI.classList.remove('hidden');
        }
      }
    });
  }

  setupCheckbox(elementId, stepKey) {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener('change', (e) => {
        this.debugSteps[stepKey] = e.target.checked;
      });
    }
  }

  getDebugSteps() {
    return this.debugSteps;
  }

  show() {
    this.debugUI.classList.remove('hidden');
  }

  hide() {
    this.debugUI.classList.add('hidden');
  }

  toggle() {
    if (this.debugUI.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }
}
