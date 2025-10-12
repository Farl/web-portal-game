import * as THREE from "three";
import { FPSController } from "./controls.js";
import { Portal } from "./portal.js";
import { PhysicsCube } from "./physics.js";
import { CONFIG } from "./config.js";
import { SceneManager } from "./sceneManager.js";
import { LevelBuilder } from "./levelBuilder.js";
import { PortalRenderer } from "./portalRenderer.js";
import { InputManager } from "./inputManager.js";
import { InteractionSystem } from "./interactionSystem.js";
import { DebugUI } from "./debugUI.js";
import { PortalPlacement } from "./portalPlacement.js";
import { PlayerController } from "./playerController.js";

/**
 * Main Game - Orchestrates all subsystems
 */
class PortalGame {
  constructor() {
    this.initializeSubsystems();
    this.setupLevel();
    this.setupPortals();
    this.setupInputCallbacks();
    this.setupRenderScaleControl();
    this.setupLevelComplete();
    this.setupUnhandledPromiseHandler();

    // Start game loop
    this.lastT = performance.now();
    this.levelCompleted = false;
    this.levelStartTime = performance.now();

    requestAnimationFrame((t) => this.animate(t));
  }

  initializeSubsystems() {
    const canvas = document.getElementById("webgl");

    // Core subsystems
    this.sceneManager = new SceneManager(canvas);
    this.levelBuilder = new LevelBuilder(this.sceneManager.scene);
    this.debugUI = new DebugUI();

    // FPS controller
    this.fps = new FPSController(this.sceneManager.camera, this.sceneManager.renderer.domElement);
    this.sceneManager.scene.add(this.fps.object);

    // Build level
    this.levelBuilder.build();

    // Player controller (collision & traversal)
    this.playerController = new PlayerController(
      this.fps,
      this.levelBuilder.getChamberBounds(),
      this.levelBuilder.getObstacles()
    );

    // Portal renderer
    this.portalRenderer = new PortalRenderer(
      this.sceneManager.renderer,
      this.sceneManager.scene,
      this.sceneManager.camera
    );

    // Portal placement
    this.portalPlacement = new PortalPlacement(
      this.levelBuilder.getChamber(),
      this.sceneManager.camera
    );

    // Input manager
    this.inputManager = new InputManager(
      canvas,
      this.sceneManager.camera,
      this.fps
    );

    // Interaction system
    this.interactionSystem = new InteractionSystem(
      this.sceneManager.scene,
      this.sceneManager.camera
    );
  }

  setupLevel() {
    // Create physics cube
    this.cube = new PhysicsCube(CONFIG.physics.cubeSize);
    this.cube.position.set(
      CONFIG.physics.cubeStartPosition.x,
      CONFIG.physics.cubeStartPosition.y,
      CONFIG.physics.cubeStartPosition.z
    );
    this.sceneManager.scene.add(this.cube);
  }

  setupPortals() {
    // Create portals
    this.bluePortal = new Portal({ color: new THREE.Color(CONFIG.portal.blueColor) });
    this.orangePortal = new Portal({ color: new THREE.Color(CONFIG.portal.orangeColor) });
    this.sceneManager.scene.add(this.bluePortal);
    this.sceneManager.scene.add(this.orangePortal);
    this.bluePortal.link(this.orangePortal);

    // Create portal masks
    this.blueMask = this.bluePortal.createMaskMesh();
    this.orangeMask = this.orangePortal.createMaskMesh();
    this.portalRenderer.getMaskScene().add(this.blueMask);
    this.portalRenderer.getMaskScene().add(this.orangeMask);

    // Place initial portals
    this.portalPlacement.placeInitialPortals(this.bluePortal, this.orangePortal);
  }

  setupInputCallbacks() {
    // Portal placement callbacks
    this.inputManager.setPlaceBluePortalCallback((e) => {
      e.preventDefault();
      if (!this.fps.enabled) return;

      // Set raycaster from center of screen (crosshair)
      const raycaster = this.inputManager.getRaycaster();
      const mouse = this.inputManager.getMouse();
      raycaster.setFromCamera(mouse.set(0, 0), this.sceneManager.camera);

      const placed = this.portalPlacement.placePortal(raycaster, this.bluePortal);

      if (placed && this.bluePortal.isPlaced) {
        this.portalPlacement.pulseBorder(this.bluePortal);
      }
    });

    this.inputManager.setPlaceOrangePortalCallback((e) => {
      e.preventDefault();
      if (!this.fps.enabled) return;

      // Set raycaster from center of screen (crosshair)
      const raycaster = this.inputManager.getRaycaster();
      const mouse = this.inputManager.getMouse();
      raycaster.setFromCamera(mouse.set(0, 0), this.sceneManager.camera);

      const placed = this.portalPlacement.placePortal(raycaster, this.orangePortal);

      if (placed && this.orangePortal.isPlaced) {
        this.portalPlacement.pulseBorder(this.orangePortal);
      }
    });

    // Interaction callbacks
    this.inputManager.setStartChargeCallback(() => {
      const grabbed = this.interactionSystem.getGrabbedCube();
      if (!grabbed) {
        // Set raycaster from center of screen for grabbing
        const raycaster = this.inputManager.getRaycaster();
        const mouse = this.inputManager.getMouse();
        raycaster.setFromCamera(mouse.set(0, 0), this.sceneManager.camera);

        this.interactionSystem.toggleGrabThrow(
          raycaster,
          this.fps.enabled,
          this.inputManager.isMobile
        );
      } else {
        this.interactionSystem.startCharge();
      }
    });

    this.inputManager.setReleaseThrowCallback(() => {
      this.interactionSystem.releaseThrow(this.fps.velocity);
    });

    // ESC key for unlocking pointer
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.fps.enabled && this.fps.controls.isLocked) {
          this.fps.controls.unlock();
        }
        this.debugUI.show();
      }
    });
  }

  setupRenderScaleControl() {
    const scaleSlider = document.getElementById('render-scale');
    const scaleLabel = document.getElementById('render-scale-label');
    const menuToggle = document.getElementById('menu-toggle');

    const updateScale = (val) => {
      this.sceneManager.setRenderScale(Number(val));
      scaleLabel.textContent = Math.round(Number(val) * 100) + '%';
    };

    menuToggle.addEventListener('click', () => {
      const panel = document.getElementById('render-scale-control');
      const visible = panel.style.display !== 'none';
      panel.style.display = visible ? 'none' : 'flex';
    });

    const savedScale = this.sceneManager.getRenderScale();
    scaleSlider.value = savedScale;
    updateScale(savedScale);

    scaleSlider.addEventListener('input', (e) => updateScale(e.target.value));
  }

  setupLevelComplete() {
    document.getElementById('retry-btn').addEventListener('click', () => {
      this.resetLevel();
    });
  }

  setupUnhandledPromiseHandler() {
    window.addEventListener('unhandledrejection', (e) => {
      const msg = String(e.reason || '');
      if (msg.includes('exited the lock')) {
        console.warn('[Handled] Promise rejected:', msg);
        e.preventDefault();
      }
    });
  }

  resetLevel() {
    this.levelCompleted = false;
    document.getElementById('level-complete').classList.add('hidden');

    this.fps.enabled = !this.inputManager.isMobile || true;
    this.fps.velocity.set(0, 0, 0);
    this.fps.object.position.set(
      CONFIG.player.startPosition.x,
      CONFIG.player.startPosition.y,
      CONFIG.player.startPosition.z
    );
    this.fps.object.rotation.set(0, 0, 0);
    this.sceneManager.camera.rotation.set(0, 0, 0);

    this.playerController.reset();
    this.interactionSystem.reset();

    this.cube.position.set(
      CONFIG.physics.cubeStartPosition.x,
      CONFIG.physics.cubeStartPosition.y,
      CONFIG.physics.cubeStartPosition.z
    );
    this.cube.velocity.set(0, 0, 0);

    this.levelStartTime = performance.now();
    this.portalPlacement.placeInitialPortals(this.bluePortal, this.orangePortal);
  }

  updatePhysics(dt) {
    // Update player
    this.fps.update(dt, (prev, next) => {
      return this.playerController.resolvePlayerCollision(
        prev,
        next,
        [this.bluePortal, this.orangePortal],
        dt
      );
    });

    // Update orientation correction
    this.playerController.applyUpVectorRecovery(this.sceneManager.camera);
    this.playerController.updateOrientationCorrection();

    // Update grabbed cube
    this.interactionSystem.updateGrabbedCube();

    // Update physics cube
    this.cube.update(
      dt,
      this.levelBuilder.getChamberBounds(),
      [this.bluePortal, this.orangePortal],
      this.levelBuilder.getObstacles()
    );

    // Update mobile look
    this.inputManager.updateMobileLook(dt);

    // Update charge
    this.interactionSystem.updateCharge();
    this.interactionSystem.updateGaugeUI();
  }

  checkGoalCompletion() {
    if (this.levelCompleted) return;

    const playerPos = this.fps.object.position.clone();
    const goalPos = this.levelBuilder.getGoal().getWorldPosition(new THREE.Vector3());

    if (playerPos.distanceTo(goalPos) < CONFIG.goal.triggerDistance) {
      if (this.fps.controls && this.fps.controls.isLocked) {
        this.fps.controls.unlock();
      }

      this.levelCompleted = true;
      this.fps.enabled = false;

      const elapsed = (performance.now() - this.levelStartTime) / 1000;
      document.getElementById('time-elapsed').textContent = `Time: ${elapsed.toFixed(2)}s`;
      document.getElementById('level-complete').classList.remove('hidden');
    }
  }

  render() {
    const debugSteps = this.debugUI.getDebugSteps();

    // Clear screen
    this.sceneManager.clearScreen(CONFIG.renderer.clearColor);

    // Check if debug stencil test mode is active
    if (debugSteps.stepA || debugSteps.stepB) {
      this.portalRenderer.hideTestObjects();
      this.portalRenderer.renderStencilTest(debugSteps);
      return; // Early return for debug mode
    }

    // Normal portal rendering
    this.portalRenderer.hideTestObjects();
    this.portalRenderer.renderPortals(
      this.bluePortal,
      this.orangePortal,
      this.blueMask,
      this.orangeMask,
      debugSteps,
      this.fps.object
    );
  }

  animate(t) {
    const dt = Math.min((t - this.lastT) / 1000, CONFIG.animation.maxDeltaTime);
    this.lastT = t;

    // Update physics and game logic
    this.updatePhysics(dt);

    // Check goal completion
    this.checkGoalCompletion();

    // Render
    this.render();

    requestAnimationFrame((t) => this.animate(t));
  }
}

// Start the game
new PortalGame();
