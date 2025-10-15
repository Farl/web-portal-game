import * as THREE from "three";
import nipplejs from "nipplejs";
import { CONFIG } from "./config.js";

/**
 * InputManager - Handles all input (keyboard, mouse, mobile joysticks)
 */
export class InputManager {
  constructor(canvas, camera, fps) {
    this.canvas = canvas;
    this.camera = camera;
    this.fps = fps;
    this.isMobile = window.matchMedia('(pointer: coarse)').matches;

    // Raycaster for portal placement and object interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Mobile controls
    this.moveVec = { x: 0, y: 0 };
    this.lookVec = { x: 0, y: 0 };
    this.leftJoystick = null;
    this.rightJoystick = null;

    // Input callbacks
    this.onPlaceBluePortal = null;
    this.onPlaceOrangePortal = null;
    this.onGrabToggle = null;
    this.onStartCharge = null;
    this.onReleaseThrow = null;

    this.setupInputHandlers();
  }

  setupInputHandlers() {
    // Desktop portal placement - prevent context menu on right click
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.canvas.addEventListener("mousedown", (e) => {
      if (!this.isMobile) this.canvas.focus();

      if (e.button === 0 && this.onPlaceBluePortal) {
        this.onPlaceBluePortal(e);
      }
      if (e.button === 2 && this.onPlaceOrangePortal) {
        this.onPlaceOrangePortal(e);
      }
    });

    // Desktop grab/throw controls
    window.addEventListener('keydown', (e) => {
      if (e.key === 'e' || e.key === 'E') {
        if (this.onStartCharge) {
          this.onStartCharge();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'e' || e.key === 'E') {
        if (this.onReleaseThrow) {
          this.onReleaseThrow();
        }
      }
    });

    // Mobile setup
    if (this.isMobile) {
      this.setupMobileControls();
    }
  }

  setupMobileControls() {
    // Enable FPS controls for mobile
    this.fps.enabled = true;

    // Left joystick for movement
    this.leftJoystick = nipplejs.create({
      zone: document.getElementById('left-joystick'),
      mode: CONFIG.mobile.joystickMode,
      color: CONFIG.mobile.joystickColor
    });

    this.leftJoystick.on('move', (_, data) => {
      this.moveVec.x = data.vector.x || 0;
      this.moveVec.y = -(data.vector.y || 0);
    });

    this.leftJoystick.on('end', () => {
      this.moveVec.x = 0;
      this.moveVec.y = 0;
    });

    // Right joystick for looking
    this.rightJoystick = nipplejs.create({
      zone: document.getElementById('right-joystick'),
      mode: CONFIG.mobile.joystickMode,
      color: CONFIG.mobile.joystickColor
    });

    this.rightJoystick.on('move', (_, data) => {
      this.lookVec.x = data.vector.x || 0;
      this.lookVec.y = -(data.vector.y || 0);
    });

    this.rightJoystick.on('end', () => {
      this.lookVec.x = 0;
      this.lookVec.y = 0;
    });

    // Mobile buttons
    const btnGrab = document.getElementById('btn-grab');
    const btnBlue = document.getElementById('btn-blue');
    const btnOrange = document.getElementById('btn-orange');

    // Prevent context menu on long press for all mobile buttons
    [btnGrab, btnBlue, btnOrange].forEach(btn => {
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // Grab button uses pointerdown/pointerup for charging mechanic
    btnGrab.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.onStartCharge) {
        this.onStartCharge();
      }
    });
    btnGrab.addEventListener('pointerup', (e) => {
      e.preventDefault();
      if (this.onReleaseThrow) {
        this.onReleaseThrow();
      }
    });

    // Portal buttons use touchstart with {passive: false} for immediate response
    btnBlue.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.onPlaceBluePortal) {
        this.onPlaceBluePortal({ preventDefault() {} });
      }
    }, { passive: false });

    btnOrange.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.onPlaceOrangePortal) {
        this.onPlaceOrangePortal({ preventDefault() {} });
      }
    }, { passive: false });
  }

  /**
   * Update mobile look controls
   */
  updateMobileLook(dt) {
    if (!this.isMobile) return;

    this.fps.moveFwd = this.moveVec.y < -CONFIG.mobile.moveThreshold;
    this.fps.moveBack = this.moveVec.y > CONFIG.mobile.moveThreshold;
    this.fps.moveLeft = this.moveVec.x < -CONFIG.mobile.moveThreshold;
    this.fps.moveRight = this.moveVec.x > CONFIG.mobile.moveThreshold;

    const lookSpeed = CONFIG.mobile.lookSpeed;
    const yawDelta = (this.lookVec.x || 0) * lookSpeed * dt;
    this.fps.controls.getObject().rotation.y -= yawDelta;

    const pitchDelta = (this.lookVec.y || 0) * lookSpeed * dt;
    this.camera.rotation.x = THREE.MathUtils.clamp(
      this.camera.rotation.x - pitchDelta,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01
    );
  }

  /**
   * Raycast for portal placement or object interaction
   */
  raycastFromCenter(objects, filterFn = null) {
    this.raycaster.setFromCamera(this.mouse.set(0, 0), this.camera);
    const intersects = this.raycaster.intersectObjects(objects, false);

    if (filterFn) {
      return intersects.filter(filterFn);
    }

    return intersects;
  }

  /**
   * Set portal placement callback
   */
  setPlaceBluePortalCallback(callback) {
    this.onPlaceBluePortal = callback;
  }

  setPlaceOrangePortalCallback(callback) {
    this.onPlaceOrangePortal = callback;
  }

  /**
   * Set interaction callbacks
   */
  setStartChargeCallback(callback) {
    this.onStartCharge = callback;
  }

  setReleaseThrowCallback(callback) {
    this.onReleaseThrow = callback;
  }

  getRaycaster() {
    return this.raycaster;
  }

  getMouse() {
    return this.mouse;
  }
}
