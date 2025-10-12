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
import { EditMode } from "./editMode.js";

/**
 * Main Game - Orchestrates all subsystems
 */
class PortalGame {
  constructor() {
    this.mode = null; // 'play' or 'edit'
    this.initializeSubsystems();
    this.setupStartMenu();
    this.setupRenderScaleControl();
    this.setupUnhandledPromiseHandler();

    // Start render loop (but don't start game until mode selected)
    this.lastT = performance.now();
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

    // Edit mode
    this.editMode = new EditMode(
      this.sceneManager.scene,
      this.sceneManager.camera,
      this.sceneManager.renderer
    );

    // Pass level builder reference to edit mode
    this.editMode.setLevelBuilder(this.levelBuilder);

    // Create default cube (visible in edit mode, used in play mode if no editor cubes)
    this.defaultCube = new PhysicsCube(CONFIG.physics.cubeSize);
    this.defaultCube.position.set(
      CONFIG.physics.cubeStartPosition.x,
      CONFIG.physics.cubeStartPosition.y,
      CONFIG.physics.cubeStartPosition.z
    );
    this.defaultCube.visible = false; // Hidden by default
    this.sceneManager.scene.add(this.defaultCube);

    // Pass default cube reference to edit mode
    this.editMode.setDefaultCube(this.defaultCube);
  }

  setupStartMenu() {
    document.getElementById('btn-play-mode').addEventListener('click', () => {
      this.startPlayMode();
    });

    document.getElementById('btn-edit-mode').addEventListener('click', () => {
      this.startEditMode();
    });
  }

  startPlayMode() {
    this.mode = 'play';
    document.getElementById('start-menu').classList.add('hidden');
    document.getElementById('ui').classList.remove('hidden');
    document.getElementById('back-to-menu').style.display = 'block';

    // Ensure edit mode is properly exited
    this.editMode.exit();

    // Re-enable FPS controls (allow pointer lock)
    this.fps.allowLock = true;

    // Setup click-to-play hint (desktop only)
    if (!this.inputManager.isMobile) {
      this.setupClickToPlayHint();
    }

    // Get editor-placed objects
    const editorObjects = this.editMode.getPlacedObjects();

    // Set player spawn position from spawner if exists
    const spawnerPos = this.editMode.getSpawnerPosition();
    if (spawnerPos) {
      this.fps.object.position.set(spawnerPos.x, spawnerPos.y + CONFIG.player.eyeHeight * 0.5, spawnerPos.z);
    } else {
      // Use default spawn position
      this.fps.object.position.set(
        CONFIG.player.startPosition.x,
        CONFIG.player.startPosition.y,
        CONFIG.player.startPosition.z
      );
    }

    // Add editor-placed objects as obstacles for collision
    const staticObjects = editorObjects.filter(obj => !obj.userData.dynamic);
    if (staticObjects.length > 0) {
      this.playerController.addObstacles(staticObjects);
    }

    // Add editor-placed objects to portal placement system
    this.portalPlacement.setEditorObjects(editorObjects);

    // Initialize play mode systems
    this.setupLevel();
    this.setupPortals();
    this.setupInputCallbacks();
    this.setupLevelComplete();
    this.setupBackToMenu();

    // Start game
    this.levelCompleted = false;
    this.levelStartTime = performance.now();
  }

  startEditMode() {
    this.mode = 'edit';

    // Disable FPS controls pointer lock
    if (this.fps.controls.isLocked) {
      this.fps.controls.unlock();
    }
    this.fps.allowLock = false;

    this.editMode.enter();
  }

  setupLevel() {
    // Check if there are editor-placed cubes
    const editorCubes = this.editMode.getPlacedObjects().filter(obj => obj.userData.dynamic);
    const editorGoals = this.editMode.getGoals();
    const editorPlatforms = this.editMode.getPlacedObjects().filter(obj => !obj.userData.dynamic && !obj.userData.goal && !obj.userData.spawner);

    // Show/hide default cube
    if (editorCubes.length === 0) {
      // Use default cube if no editor cubes exist
      this.cube = this.defaultCube;
      this.cube.visible = true;
      // Reset cube position
      this.cube.position.set(
        CONFIG.physics.cubeStartPosition.x,
        CONFIG.physics.cubeStartPosition.y,
        CONFIG.physics.cubeStartPosition.z
      );
      this.cube.velocity.set(0, 0, 0);
    } else {
      // Use editor cubes
      this.cube = null;
      this.defaultCube.visible = false;
      this.editorCubes = editorCubes;
      // Add velocity property if not already present
      editorCubes.forEach(cube => {
        if (!cube.velocity) {
          cube.velocity = new THREE.Vector3(0, 0, 0);
        }
      });
    }

    // Show/hide default goal
    const defaultGoal = this.levelBuilder.getGoal();
    if (editorGoals.length > 0) {
      if (defaultGoal) defaultGoal.visible = false;
    } else {
      if (defaultGoal) defaultGoal.visible = true;
    }

    // Show/hide default second floor
    const secondFloor = this.levelBuilder.secondFloor;
    if (editorPlatforms.length > 0 || editorGoals.length > 0) {
      if (secondFloor) secondFloor.visible = false;
    } else {
      if (secondFloor) secondFloor.visible = true;
    }
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
      // Only place portal if pointer is already locked
      if (!this.fps.enabled || !this.fps.controls.isLocked) return;

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
      // Only place portal if pointer is already locked
      if (!this.fps.enabled || !this.fps.controls.isLocked) return;

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

  setupClickToPlayHint() {
    const clickToPlay = document.getElementById('click-to-play');

    // Show hint initially (pointer not locked at start)
    clickToPlay.classList.remove('hidden');

    // Listen for pointer lock events
    this.fps.controls.addEventListener('lock', () => {
      clickToPlay.classList.add('hidden');
    });

    this.fps.controls.addEventListener('unlock', () => {
      // Only show hint if in play mode
      if (this.mode === 'play') {
        clickToPlay.classList.remove('hidden');
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

  setupBackToMenu() {
    const backBtn = document.getElementById('back-to-menu');
    backBtn.addEventListener('click', () => {
      this.exitToMenu();
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

    // Pointer lock should still be allowed in play mode
    this.fps.allowLock = true;
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

  exitToMenu() {
    // Unlock pointer controls
    if (this.fps.controls.isLocked) {
      this.fps.controls.unlock();
    }

    // Hide play mode UI
    document.getElementById('ui').classList.add('hidden');
    document.getElementById('level-complete').classList.add('hidden');
    document.getElementById('back-to-menu').style.display = 'none';
    document.getElementById('click-to-play').classList.add('hidden');

    // Show start menu
    document.getElementById('start-menu').classList.remove('hidden');

    // Clean up play mode objects
    // Hide default cube (don't remove it, it's persistent)
    if (this.defaultCube) {
      this.defaultCube.visible = false;
    }
    this.cube = null;
    if (this.editorCubes) {
      this.editorCubes = null;
    }
    if (this.bluePortal) {
      this.sceneManager.scene.remove(this.bluePortal);
      this.portalRenderer.getMaskScene().remove(this.blueMask);
      this.bluePortal = null;
      this.blueMask = null;
    }
    if (this.orangePortal) {
      this.sceneManager.scene.remove(this.orangePortal);
      this.portalRenderer.getMaskScene().remove(this.orangeMask);
      this.orangePortal = null;
      this.orangeMask = null;
    }

    // Hide default level objects (they will be shown conditionally when entering play mode)
    const defaultGoal = this.levelBuilder.getGoal();
    if (defaultGoal) defaultGoal.visible = false;
    const secondFloor = this.levelBuilder.secondFloor;
    if (secondFloor) secondFloor.visible = false;

    // Reset player state
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

    // Reset obstacles to original level obstacles only
    this.playerController.setObstacles(this.levelBuilder.getObstacles());

    // Clear mode
    this.mode = null;
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

    // Update physics cubes (default or editor-placed)
    if (this.cube) {
      this.cube.update(
        dt,
        this.levelBuilder.getChamberBounds(),
        [this.bluePortal, this.orangePortal],
        this.levelBuilder.getObstacles()
      );
    }

    // Update editor cubes with simple physics
    if (this.editorCubes) {
      const allObstacles = [...this.levelBuilder.getObstacles(), ...this.editMode.getPlacedObjects().filter(obj => !obj.userData.dynamic)];
      this.editorCubes.forEach(cube => {
        if (!cube.isGrabbed) {
          this.updateSimpleCubePhysics(cube, dt, allObstacles);
        }
      });
    }

    // Update mobile look
    this.inputManager.updateMobileLook(dt);

    // Update charge
    this.interactionSystem.updateCharge();
    this.interactionSystem.updateGaugeUI();
  }

  updateSimpleCubePhysics(cube, dt, obstacles) {
    // Apply gravity
    cube.velocity.y -= 9.8 * dt;

    // Apply velocity
    const nextPos = cube.position.clone().add(cube.velocity.clone().multiplyScalar(dt));

    // Check collisions with chamber bounds
    const bounds = this.levelBuilder.getChamberBounds();
    const r = 0.25; // cube half-size
    nextPos.x = THREE.MathUtils.clamp(nextPos.x, bounds.min.x + r, bounds.max.x - r);
    nextPos.z = THREE.MathUtils.clamp(nextPos.z, bounds.min.z + r, bounds.max.z - r);

    if (nextPos.y - r < bounds.min.y) {
      nextPos.y = bounds.min.y + r;
      cube.velocity.y = 0;
    }

    // Simple obstacle collision (similar to player)
    for (const obj of obstacles) {
      const box = new THREE.Box3().setFromObject(obj);
      const expanded = box.clone().expandByScalar(r);

      if (expanded.containsPoint(nextPos)) {
        const center = expanded.getCenter(new THREE.Vector3());
        const dir = nextPos.clone().sub(center).normalize();
        nextPos.copy(center).add(dir.multiplyScalar(expanded.getSize(new THREE.Vector3()).length() * 0.5 + r));
        cube.velocity.multiplyScalar(0.5); // Dampen velocity on collision
      }
    }

    cube.position.copy(nextPos);
  }

  checkGoalCompletion() {
    if (this.levelCompleted) return;

    const playerPos = this.fps.object.position.clone();

    // Check editor-placed goals first, then default level goal
    const editorGoals = this.editMode.getGoals();
    const goalsToCheck = editorGoals.length > 0 ? editorGoals : [this.levelBuilder.getGoal()];

    for (const goal of goalsToCheck) {
      const goalPos = goal.getWorldPosition(new THREE.Vector3());

      if (playerPos.distanceTo(goalPos) < CONFIG.goal.triggerDistance) {
        if (this.fps.controls && this.fps.controls.isLocked) {
          this.fps.controls.unlock();
        }

        this.levelCompleted = true;
        this.fps.enabled = false;

        const elapsed = (performance.now() - this.levelStartTime) / 1000;
        document.getElementById('time-elapsed').textContent = `Time: ${elapsed.toFixed(2)}s`;
        document.getElementById('level-complete').classList.remove('hidden');
        break;
      }
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

    if (this.mode === 'play') {
      // Play mode: update physics and game logic
      this.updatePhysics(dt);
      this.checkGoalCompletion();
      this.render();
    } else if (this.mode === 'edit') {
      // Edit mode: update editor
      this.editMode.update(dt);
      // Simple render without portals
      this.sceneManager.clearScreen(CONFIG.renderer.clearColor);
      this.sceneManager.render();
    } else {
      // No mode selected yet, just render the scene
      this.sceneManager.clearScreen(CONFIG.renderer.clearColor);
      this.sceneManager.render();
    }

    requestAnimationFrame((t) => this.animate(t));
  }
}

// Start the game
new PortalGame();
