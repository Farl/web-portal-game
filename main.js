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

    // Create default player spawner (visual indicator in edit mode)
    this.defaultSpawner = new THREE.Group();
    const spawnerGeom = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16);
    const spawnerMat = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      emissive: 0x00ff00,
      emissiveIntensity: 0.3
    });
    const spawnerMesh = new THREE.Mesh(spawnerGeom, spawnerMat);
    spawnerMesh.rotation.x = Math.PI / 2; // Lay flat
    this.defaultSpawner.add(spawnerMesh);

    // Add arrow to show forward direction
    const arrowGeom = new THREE.ConeGeometry(0.15, 0.4, 8);
    const arrowMesh = new THREE.Mesh(arrowGeom, spawnerMat);
    arrowMesh.position.z = 0.3;
    arrowMesh.rotation.x = -Math.PI / 2;
    this.defaultSpawner.add(arrowMesh);

    this.defaultSpawner.position.set(
      CONFIG.player.startPosition.x,
      CONFIG.player.startPosition.y,
      CONFIG.player.startPosition.z
    );
    this.defaultSpawner.userData.spawner = true; // Mark as spawner for editor
    this.defaultSpawner.visible = false; // Hidden by default
    this.sceneManager.scene.add(this.defaultSpawner);

    // Pass default objects references to edit mode
    this.editMode.setDefaultCube(this.defaultCube);
    this.editMode.setDefaultSpawner(this.defaultSpawner);
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

    // Hide start menu and show play UI
    document.getElementById('start-menu').classList.add('hidden');
    document.getElementById('ui').classList.remove('hidden');
    document.getElementById('back-to-menu').style.display = 'block';

    // Ensure edit mode UI is hidden and controls are disabled
    document.getElementById('edit-ui').classList.add('hidden');
    this.editMode.isMouseLookActive = false;
    document.exitPointerLock();
    // Ensure transform controls are removed from scene
    if (this.editMode.transformControls.parent) {
      this.editMode.scene.remove(this.editMode.transformControls);
    }
    this.editMode.transformControls.enabled = false;
    this.editMode.transformControls.visible = false;

    // Hide edit-only objects (spawner, preview, etc)
    if (this.defaultSpawner) {
      this.defaultSpawner.visible = false;
      // Explicitly hide children as well
      this.defaultSpawner.traverse((child) => {
        if (child.isMesh) {
          child.visible = false;
        }
      });
    }

    // Re-enable FPS controls (allow pointer lock)
    this.fps.allowLock = true;

    // Setup click-to-play hint (desktop only)
    if (!this.inputManager.isMobile) {
      this.setupClickToPlayHint();
    }

    // Reset camera orientation for play mode
    this.fps.object.rotation.set(0, 0, 0);
    this.sceneManager.camera.rotation.set(0, 0, 0);

    // Get editor-placed objects
    const editorObjects = this.editMode.getPlacedObjects();

    // Set player spawn position and rotation from spawner if exists
    const spawnerData = this.editMode.getSpawnerPosition();
    if (spawnerData) {
      const pos = spawnerData.position;
      this.fps.object.position.set(pos.x, pos.y + CONFIG.player.eyeHeight * 0.5, pos.z);
      // Apply spawner rotation to player (only Y-axis rotation for facing direction)
      this.fps.object.rotation.y = spawnerData.rotation.y;
      this.sceneManager.camera.rotation.y = spawnerData.rotation.y;
    } else {
      // Use default spawn position
      this.fps.object.position.set(
        CONFIG.player.startPosition.x,
        CONFIG.player.startPosition.y,
        CONFIG.player.startPosition.z
      );
    }

    // Add editor-placed objects as obstacles for collision
    // Exclude spawners and goals - they are markers, not obstacles
    const staticObjects = editorObjects.filter(obj =>
      !obj.userData.dynamic &&
      !obj.userData.spawner &&
      !obj.userData.goal
    );
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

    // Reset all cubes to their spawn positions
    this.resetCubesToSpawn();

    // Ensure spawner is visible in edit mode
    if (this.defaultSpawner) {
      this.defaultSpawner.visible = true;
      this.defaultSpawner.traverse((child) => {
        if (child.isMesh) {
          child.visible = true;
          // Reset stencil properties that may have been set by portal renderer
          if (child.material) {
            child.material.stencilWrite = false;
            child.material.stencilFunc = THREE.AlwaysStencilFunc;
            child.material.stencilRef = 0;
            child.material.needsUpdate = true;
          }
        }
      });
    }

    this.editMode.enter();
  }

  resetCubesToSpawn() {
    // Reset default cube to spawn position
    if (this.defaultCube) {
      this.defaultCube.position.set(
        CONFIG.physics.cubeStartPosition.x,
        CONFIG.physics.cubeStartPosition.y,
        CONFIG.physics.cubeStartPosition.z
      );
      this.defaultCube.velocity.set(0, 0, 0);
      this.defaultCube.rotation.set(0, 0, 0);
    }

    // Reset editor cubes to their spawn positions
    const editorCubes = this.editMode.getPlacedObjects().filter(obj => obj.userData.dynamic);
    editorCubes.forEach(cube => {
      if (cube.userData.initialPosition) {
        cube.position.copy(cube.userData.initialPosition);
      }
      if (cube.velocity) {
        cube.velocity.set(0, 0, 0);
      }
      cube.rotation.set(0, 0, 0);
    });
  }

  setupLevel() {
    // Check if there are editor-placed objects
    const editorCubes = this.editMode.getPlacedObjects().filter(obj => obj.userData.dynamic);
    const editorGoals = this.editMode.getGoals();

    // Always show and reset default cube in play mode
    this.defaultCube.visible = true;
    this.defaultCube.position.set(
      CONFIG.physics.cubeStartPosition.x,
      CONFIG.physics.cubeStartPosition.y,
      CONFIG.physics.cubeStartPosition.z
    );
    this.defaultCube.velocity.set(0, 0, 0);
    this.defaultCube.scale.set(1, 1, 1); // Reset scale
    this.defaultCube.userData.consumed = false; // Reset consumed state

    // Set up cube references for physics
    this.cube = this.defaultCube;
    this.editorCubes = editorCubes;

    // Reset editor cubes to their spawn positions
    editorCubes.forEach(cube => {
      if (!cube.velocity) {
        cube.velocity = new THREE.Vector3(0, 0, 0);
      }
      // Always reset to initial spawn position
      if (cube.userData.initialPosition) {
        cube.position.copy(cube.userData.initialPosition);
      }
      cube.velocity.set(0, 0, 0);
      cube.rotation.set(0, 0, 0);
      cube.scale.set(1, 1, 1); // Reset scale
      cube.userData.consumed = false; // Reset consumed state
      cube.visible = true; // Make sure it's visible
    });

    // Reset and show all doors (default + editor-placed)
    const allDoors = this.editMode.getDoors();
    allDoors.forEach(door => {
      door.visible = true;
      door.userData.isOpen = false; // Reset to closed state
      door.scale.set(1, 1, 1); // Reset scale
      // Ensure all children (door frame parts) are visible
      door.traverse((child) => {
        child.visible = true;
      });
    });

    // Always show default second floor in play mode
    const secondFloor = this.levelBuilder.secondFloor;
    if (secondFloor) secondFloor.visible = true;
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
      // On mobile, FPS is always enabled but pointer lock doesn't exist
      // On desktop, only place portal if pointer is locked
      if (!this.fps.enabled) return;
      if (!this.inputManager.isMobile && !this.fps.controls.isLocked) return;

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
      // On mobile, FPS is always enabled but pointer lock doesn't exist
      // On desktop, only place portal if pointer is locked
      if (!this.fps.enabled) return;
      if (!this.inputManager.isMobile && !this.fps.controls.isLocked) return;

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

    // Prepare obstacle list including editor-placed platforms
    const editorPlatforms = this.editMode.getPlacedObjects().filter(obj => !obj.userData.dynamic && !obj.userData.goal && !obj.userData.spawner);
    const allObstacles = [...this.levelBuilder.getObstacles(), ...editorPlatforms];

    // Update default physics cube
    if (this.cube) {
      this.cube.update(
        dt,
        this.levelBuilder.getChamberBounds(),
        [this.bluePortal, this.orangePortal],
        allObstacles
      );
    }

    // Update editor cubes with full physics (same as default cube)
    if (this.editorCubes) {
      this.editorCubes.forEach(cube => {
        cube.update(
          dt,
          this.levelBuilder.getChamberBounds(),
          [this.bluePortal, this.orangePortal],
          allObstacles
        );
      });
    }

    // Update mobile look
    this.inputManager.updateMobileLook(dt);

    // Update charge
    this.interactionSystem.updateCharge();
    this.interactionSystem.updateGaugeUI();

    // Check door-cube collisions
    this.checkDoorCubeCollisions();
  }

  checkDoorCubeCollisions() {
    // Get all obstacle doors (not exit doors) including default door
    const allDoors = this.editMode.getDoors();
    const obstacleDoors = allDoors.filter(door => !door.userData.isExitDoor && !door.userData.isOpen);

    if (obstacleDoors.length === 0) return;

    // Get all active cubes
    const allCubes = [this.cube, ...(this.editorCubes || [])].filter(cube => cube && cube.visible);

    // Check each cube against each obstacle door
    obstacleDoors.forEach(door => {
      const doorPos = door.getWorldPosition(new THREE.Vector3());
      const doorSize = 1.0; // Door width/height for collision

      allCubes.forEach(cube => {
        if (cube.userData.consumed) return; // Skip already consumed cubes

        // Get world position (important for grabbed cubes which are parented to camera)
        const cubePos = cube.getWorldPosition(new THREE.Vector3());
        const cubeSize = cube.size || 0.2;

        // Simple AABB collision detection
        const distance = cubePos.distanceTo(doorPos);
        if (distance < (doorSize + cubeSize) / 2) {
          // Collision detected! Open the door and consume the cube
          this.openDoor(door);
          this.consumeCube(cube);
        }
      });
    });
  }

  openDoor(door) {
    door.userData.isOpen = true;
    // Animate door closing (scale to 0)
    const animationDuration = 0.5; // 0.5 seconds
    const startScale = door.scale.clone();
    const startTime = performance.now();

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const progress = Math.min(elapsed / animationDuration, 1.0);

      // Ease out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      door.scale.lerpVectors(startScale, new THREE.Vector3(0, 0, 0), easeProgress);

      if (progress < 1.0) {
        requestAnimationFrame(animate);
      } else {
        door.visible = false; // Hide completely when animation is done
      }
    };

    animate();
  }

  consumeCube(cube) {
    cube.userData.consumed = true;
    // Animate cube disappearing (scale to 0)
    const animationDuration = 0.5; // 0.5 seconds
    const startScale = cube.scale.clone();
    const startTime = performance.now();

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const progress = Math.min(elapsed / animationDuration, 1.0);

      // Ease out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      cube.scale.lerpVectors(startScale, new THREE.Vector3(0, 0, 0), easeProgress);

      if (progress < 1.0) {
        requestAnimationFrame(animate);
      } else {
        cube.visible = false; // Hide completely when animation is done
      }
    };

    animate();
  }

  checkGoalCompletion() {
    if (this.levelCompleted) return;

    const playerPos = this.fps.object.position.clone();

    // Check all exit doors (default + editor-placed)
    const allDoors = this.editMode.getDoors();
    const exitDoors = allDoors.filter(door => door.userData.isExitDoor);

    for (const door of exitDoors) {
      const doorPos = door.getWorldPosition(new THREE.Vector3());

      if (playerPos.distanceTo(doorPos) < CONFIG.goal.triggerDistance) {
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

    // Sort transparent objects by distance from camera
    this.sortTransparentObjects();

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

  /**
   * Sort transparent objects by distance from camera (back-to-front)
   */
  sortTransparentObjects() {
    const transparentObjects = [];
    this.sceneManager.scene.traverse((obj) => {
      if (obj.userData.transparent && obj.isMesh) {
        transparentObjects.push(obj);
      }
    });

    if (transparentObjects.length === 0) return;

    // Sort by distance from camera (far to near for proper alpha blending)
    const cameraPos = this.sceneManager.camera.position;
    transparentObjects.sort((a, b) => {
      const distA = a.position.distanceToSquared(cameraPos);
      const distB = b.position.distanceToSquared(cameraPos);
      return distB - distA; // Render farthest first
    });

    // Update renderOrder based on distance
    transparentObjects.forEach((obj, index) => {
      obj.renderOrder = 1000 + index;
    });
  }
}

// Start the game
new PortalGame();
