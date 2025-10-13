import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { CONFIG } from "./config.js";
import { PhysicsCube } from "./physics.js";

/**
 * EditMode - Level editor with god camera and object placement
 */
export class EditMode {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    // Yaw/Pitch mouse look controls
    this.yaw = 0;
    this.pitch = 0;
    this.mouseSensitivity = 0.002;
    this.isMouseLookActive = false;

    // Transform controls for gizmos
    this.transformControls = new TransformControls(camera, renderer.domElement);
    this.isDraggingTransform = false;
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.isDraggingTransform = event.value;
    });

    // Set snapping for transform controls
    this.transformControls.setTranslationSnap(0.5); // 0.5 unit grid for translation
    this.transformControls.setRotationSnap(THREE.MathUtils.degToRad(90)); // 90 degrees for rotation
    this.transformControls.setScaleSnap(0.1); // 0.1 scale snap (0.5 unit increments for 5-unit objects)

    this.transformControls.visible = false; // Hidden by default
    this.transformControls.enabled = false; // Disabled by default
    this.scene.add(this.transformControls);
    this.selectedObject = null;

    // Current tool mode
    this.currentToolMode = 'translate';

    // Selection circle gizmo
    this.selectionCircle = this.createSelectionCircle();
    this.scene.add(this.selectionCircle);
    this.selectionCircle.visible = false;

    // WASD movement state
    this.moveState = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false
    };
    this.moveSpeed = 10.0;

    // Edit state
    this.selectedObjectType = null;
    this.placementGrid = 0.5; // Grid snapping size (0.5 unit grid)
    this.objects = []; // Track placed objects

    // Preview mesh
    this.previewMesh = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(0, 0);

    // References to default level objects
    this.levelBuilder = null;
    this.defaultCube = null;
    this.defaultSpawner = null;

    this.setupControls();
    this.setupUI();
  }

  setupControls() {
    // Keyboard controls
    const onKeyDown = (e) => {
      switch (e.code) {
        // W key - dual function: camera forward OR translate mode
        case "KeyW":
          if (this.isMouseLookActive) {
            // Camera movement when RMB is held
            this.moveState.forward = true;
          } else {
            // Switch to translate mode when RMB is NOT held
            this.currentToolMode = 'translate';
            this.selectionCircle.visible = false;
            this.transformControls.enabled = true;
            if (this.selectedObject) {
              this.setTransformMode('translate');
            }
            this.updateTransformModeUI('translate');
          }
          break;
        // Movement keys only work when right mouse button is held
        case "KeyS":
          if (this.isMouseLookActive) this.moveState.backward = true;
          break;
        case "KeyA":
          if (this.isMouseLookActive) this.moveState.left = true;
          break;
        case "KeyD":
          if (this.isMouseLookActive) this.moveState.right = true;
          break;
        case "Space":
          if (this.isMouseLookActive) {
            this.moveState.up = true;
            e.preventDefault();
          }
          break;
        case "ShiftLeft":
          if (this.isMouseLookActive) this.moveState.down = true;
          break;
        // Transform mode shortcuts (only work when RMB is NOT held)
        case "KeyQ":
          if (!this.isMouseLookActive) {
            // Select mode
            this.currentToolMode = 'select';
            this.transformControls.visible = false;
            this.transformControls.enabled = false;
            this.selectionCircle.visible = !!this.selectedObject;
            if (this.selectedObject) {
              this.updateSelectionCircle();
            }
            this.updateTransformModeUI('select');
          }
          break;
        case "KeyE":
          if (!this.isMouseLookActive) {
            // Rotate mode
            this.currentToolMode = 'rotate';
            this.selectionCircle.visible = false;
            this.transformControls.enabled = true;
            if (this.selectedObject) {
              this.setTransformMode('rotate');
            }
            this.updateTransformModeUI('rotate');
          }
          break;
        case "KeyR":
          if (!this.isMouseLookActive) {
            // Scale mode
            this.currentToolMode = 'scale';
            this.selectionCircle.visible = false;
            this.transformControls.enabled = true;
            if (this.selectedObject) {
              this.setTransformMode('scale');
            }
            this.updateTransformModeUI('scale');
          }
          break;
        case "Delete":
        case "Backspace":
          this.deleteSelectedObject();
          e.preventDefault();
          break;
        case "Escape":
          // Cancel object placement mode or deselect object
          if (this.selectedObjectType) {
            this.clearObjectSelection();
            document.querySelectorAll('[data-type]').forEach(b => b.classList.remove('active'));
          } else {
            this.deselectObject();
          }
          break;
      }
    };

    const onKeyUp = (e) => {
      switch (e.code) {
        case "KeyW": this.moveState.forward = false; break;
        case "KeyS": this.moveState.backward = false; break;
        case "KeyA": this.moveState.left = false; break;
        case "KeyD": this.moveState.right = false; break;
        case "Space": this.moveState.up = false; break;
        case "ShiftLeft": this.moveState.down = false; break;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    // Mouse click to place object or select
    this.renderer.domElement.addEventListener("click", (e) => {
      // Ignore click if we just finished dragging the transform controls
      if (this.isDraggingTransform) {
        return;
      }

      // Update mouse position
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (this.selectedObjectType) {
        this.placeObject();
      } else {
        this.selectObjectAtCursor();
      }
    });

    // Mouse move for preview and look
    this.renderer.domElement.addEventListener("mousemove", (e) => {
      // Update mouse position
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Mouse look (right mouse button held)
      if (this.isMouseLookActive) {
        this.yaw -= e.movementX * this.mouseSensitivity;
        this.pitch -= e.movementY * this.mouseSensitivity;

        // Clamp pitch to prevent camera flipping
        this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));

        this.updateCameraRotation();
      }

      if (this.selectedObjectType) {
        this.updatePreview();
      }
    });

    // Right mouse button for mouse look
    this.onMouseDown = (e) => {
      if (e.button === 2) { // Right mouse button
        this.isMouseLookActive = true;
        this.renderer.domElement.requestPointerLock();
      }
    };

    this.onMouseUp = (e) => {
      if (e.button === 2) {
        this.isMouseLookActive = false;
        document.exitPointerLock();

        // Reset all movement states when releasing RMB
        this.moveState.forward = false;
        this.moveState.backward = false;
        this.moveState.left = false;
        this.moveState.right = false;
        this.moveState.up = false;
        this.moveState.down = false;
      }
    };

    // Store event listeners so we can remove them later
    this.boundMouseDown = this.onMouseDown.bind(this);
    this.boundMouseUp = this.onMouseUp.bind(this);

    // Prevent context menu on right click
    this.renderer.domElement.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
  }

  createSelectionCircle() {
    // Create a simple circle gizmo for select mode
    const geometry = new THREE.RingGeometry(0.4, 0.5, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
      depthTest: false
    });
    const circle = new THREE.Mesh(geometry, material);
    circle.renderOrder = 999; // Render on top
    return circle;
  }

  updateSelectionCircle() {
    if (!this.selectedObject || !this.selectionCircle.visible) return;

    // Position circle at object's center
    const worldPos = new THREE.Vector3();
    this.selectedObject.getWorldPosition(worldPos);
    this.selectionCircle.position.copy(worldPos);

    // Use fixed scale for all objects (consistent size)
    this.selectionCircle.scale.setScalar(3.0);

    // Billboard effect - face camera
    this.selectionCircle.quaternion.copy(this.camera.quaternion);
  }

  updateCameraRotation() {
    // Apply yaw and pitch to camera rotation
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  setupUI() {
    // Object type selection buttons
    const buttons = document.querySelectorAll('[data-type]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Toggle: if already selected, deselect it
        if (this.selectedObjectType === btn.dataset.type) {
          this.clearObjectSelection();
          buttons.forEach(b => b.classList.remove('active'));
        } else {
          this.selectObjectType(btn.dataset.type);
          // Update active state
          buttons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });

    // Transform mode buttons
    const transformButtons = document.querySelectorAll('[data-mode]');
    transformButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.currentToolMode = mode; // Always update current tool mode

        if (mode === 'select') {
          // Select mode - show selection circle, hide and disable transform gizmos
          this.transformControls.visible = false;
          this.transformControls.enabled = false;
          if (this.selectedObject) {
            this.selectionCircle.visible = true;
            this.updateSelectionCircle();
          }
        } else {
          // Transform modes - hide selection circle, enable transform gizmos
          this.selectionCircle.visible = false;
          this.transformControls.enabled = true;
          if (this.selectedObject) {
            this.setTransformMode(mode);
          }
        }
        this.updateTransformModeUI(mode);
      });
    });

    // Delete button
    document.getElementById('btn-delete').addEventListener('click', () => {
      this.deleteSelectedObject();
    });

    // Exit edit mode button
    document.getElementById('btn-exit-edit').addEventListener('click', () => {
      this.exit();
    });
  }

  selectObjectType(type) {
    this.selectedObjectType = type;
    this.createPreviewMesh();
  }

  clearObjectSelection() {
    this.selectedObjectType = null;
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh = null;
    }
  }

  createPreviewMesh() {
    // Remove old preview
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
    }

    if (!this.selectedObjectType) return;

    let geometry, material;

    switch (this.selectedObjectType) {
      case 'wall':
        geometry = new THREE.BoxGeometry(5, 5, 0.2);
        material = new THREE.MeshStandardMaterial({
          color: 0xcccccc,
          transparent: true,
          opacity: 0.5,
          wireframe: false
        });
        break;
      case 'platform':
        // Use second floor dimensions: halfRoomScale x wallThickness x halfRoomScale
        geometry = new THREE.BoxGeometry(5, 0.2, 5);
        material = new THREE.MeshStandardMaterial({
          color: 0xdddddd,
          transparent: true,
          opacity: 0.5
        });
        break;
      case 'cube':
        geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        material = new THREE.MeshStandardMaterial({
          color: 0x00ffff,
          transparent: true,
          opacity: 0.5
        });
        break;
      case 'goal':
        geometry = new THREE.BoxGeometry(1, 1, 1);
        material = new THREE.MeshStandardMaterial({
          color: 0xffff00,
          transparent: true,
          opacity: 0.5,
          emissive: 0xffff00,
          emissiveIntensity: 0.3
        });
        break;
      case 'spawner':
        geometry = new THREE.CylinderGeometry(0.3, 0.3, 1.6, 16);
        material = new THREE.MeshStandardMaterial({
          color: 0x00ff00,
          transparent: true,
          opacity: 0.6,
          emissive: 0x00ff00,
          emissiveIntensity: 0.3
        });
        break;
    }

    this.previewMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.previewMesh);
  }

  updatePreview() {
    if (!this.previewMesh) return;

    // Raycast from mouse to find placement position
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Create a grid plane at y=0 for floor/ceiling, or use existing objects
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectPoint = new THREE.Vector3();

    this.raycaster.ray.intersectPlane(groundPlane, intersectPoint);

    if (intersectPoint) {
      // Snap to grid
      intersectPoint.x = Math.round(intersectPoint.x / this.placementGrid) * this.placementGrid;
      intersectPoint.y = Math.round(intersectPoint.y / this.placementGrid) * this.placementGrid;
      intersectPoint.z = Math.round(intersectPoint.z / this.placementGrid) * this.placementGrid;

      this.previewMesh.position.copy(intersectPoint);
    }
  }

  placeObject() {
    if (!this.previewMesh) return;

    const position = this.previewMesh.position.clone();
    let mesh;

    switch (this.selectedObjectType) {
      case 'wall':
        mesh = this.createWall(position);
        break;
      case 'platform':
        mesh = this.createPlatform(position);
        break;
      case 'cube':
        mesh = this.createCube(position);
        break;
      case 'goal':
        mesh = this.createGoal(position);
        break;
      case 'spawner':
        mesh = this.createSpawner(position);
        break;
    }

    if (mesh) {
      this.scene.add(mesh);
      this.objects.push(mesh);
    }
  }

  createGridTexture(baseColor, divisions = 3, withCrossLines = false) {
    const textureSize = CONFIG.texture.gridSize;
    const canvas = document.createElement('canvas');
    canvas.width = textureSize;
    canvas.height = textureSize;
    const ctx = canvas.getContext('2d');

    // Draw base color
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, textureSize, textureSize);

    // Draw grid - use same style as levelBuilder
    ctx.strokeStyle = CONFIG.texture.gridColor;
    ctx.lineWidth = CONFIG.texture.gridLineWidth;
    ctx.globalAlpha = CONFIG.room.gridOpacity;

    const div = 1;
    const gridSize = textureSize / div;
    for (let i = 0; i <= div; i++) {
      ctx.beginPath();
      ctx.moveTo(i * gridSize, 0);
      ctx.lineTo(i * gridSize, textureSize);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i * gridSize);
      ctx.lineTo(textureSize, i * gridSize);
      ctx.stroke();
    }

    // Draw cross lines for non-portalable surfaces
    if (withCrossLines) {
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.8;

      // Diagonal cross from corner to corner
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(textureSize, textureSize);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(textureSize, 0);
      ctx.lineTo(0, textureSize);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(divisions, divisions);
    return texture;
  }

  createWall(position) {
    const isPortalable = document.getElementById('portalable-checkbox').checked;
    // Use reasonable wall size: 5 x 5 x 0.2 (same proportions as chamber walls)
    const geometry = new THREE.BoxGeometry(5, 5, 0.2);

    let material;
    if (isPortalable) {
      // Use chamber wall color (neutral gray) with clean grid
      const texture = this.createGridTexture('#cccccc', 5, false);
      material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.0
      });
    } else {
      // Non-portalable: same grid texture but with cross lines
      const texture = this.createGridTexture('#cccccc', 5, true);
      material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.0
      });
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.portalable = isPortalable;
    mesh.userData.editorPlaced = true;
    return mesh;
  }

  createPlatform(position) {
    const isPortalable = document.getElementById('portalable-checkbox').checked;
    // Use second floor dimensions: 5 x 0.2 x 5
    const geometry = new THREE.BoxGeometry(5, 0.2, 5);

    let material;
    if (isPortalable) {
      // Use second floor grid texture with clean grid
      const texture = this.createGridTexture('#dddddd', 5, false);
      material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.0
      });
    } else {
      // Non-portalable: same grid texture but with cross lines
      const texture = this.createGridTexture('#dddddd', 5, true);
      material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.0
      });
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.portalable = isPortalable;
    mesh.userData.editorPlaced = true;
    return mesh;
  }

  createCube(position) {
    // Use PhysicsCube class for full physics behavior
    const cube = new PhysicsCube(0.2);
    cube.position.copy(position);
    cube.userData.editorPlaced = true;
    // Store initial position for reset
    cube.userData.initialPosition = position.clone();
    return cube;
  }

  createGoal(position) {
    const geometry = new THREE.BoxGeometry(1, 2, 0.2);
    const material = new THREE.MeshStandardMaterial({
      color: 0xFF00FF,
      roughness: 0.7,
      metalness: 0.0
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.goal = true;
    mesh.userData.editorPlaced = true;
    return mesh;
  }

  createSpawner(position) {
    // Only allow one spawner - remove existing one
    const existingSpawner = this.objects.find(obj => obj.userData.spawner);
    if (existingSpawner) {
      this.scene.remove(existingSpawner);
      const index = this.objects.indexOf(existingSpawner);
      if (index > -1) {
        this.objects.splice(index, 1);
      }
    }

    // Create spawner as Group (same structure as default spawner)
    const spawnerGroup = new THREE.Group();

    // Cylinder base (same as default)
    const spawnerGeom = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16);
    const spawnerMat = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      emissive: 0x00ff00,
      emissiveIntensity: 0.3
    });
    const spawnerMesh = new THREE.Mesh(spawnerGeom, spawnerMat);
    spawnerMesh.rotation.x = Math.PI / 2; // Lay flat
    spawnerGroup.add(spawnerMesh);

    // Arrow to show forward direction (same as default)
    const arrowGeom = new THREE.ConeGeometry(0.15, 0.4, 8);
    const arrowMesh = new THREE.Mesh(arrowGeom, spawnerMat);
    arrowMesh.position.z = 0.3;
    arrowMesh.rotation.x = -Math.PI / 2;
    spawnerGroup.add(arrowMesh);

    spawnerGroup.position.copy(position);
    spawnerGroup.userData.spawner = true;
    spawnerGroup.userData.editorPlaced = true;
    return spawnerGroup;
  }

  update(dt) {
    // WASD fly-through movement
    const velocity = new THREE.Vector3();

    if (this.moveState.forward || this.moveState.backward ||
        this.moveState.left || this.moveState.right ||
        this.moveState.up || this.moveState.down) {

      // Get camera direction (forward/backward)
      const direction = new THREE.Vector3();
      direction.set(
        -Math.sin(this.yaw),
        0,
        -Math.cos(this.yaw)
      ).normalize();

      // Get right vector (left/right)
      const right = new THREE.Vector3();
      right.set(
        Math.cos(this.yaw),
        0,
        -Math.sin(this.yaw)
      ).normalize();

      // Calculate movement
      if (this.moveState.forward) velocity.add(direction);
      if (this.moveState.backward) velocity.sub(direction);
      if (this.moveState.right) velocity.add(right);
      if (this.moveState.left) velocity.sub(right);
      if (this.moveState.up) velocity.y += 1;
      if (this.moveState.down) velocity.y -= 1;

      // Apply movement
      if (velocity.lengthSq() > 0) {
        velocity.normalize().multiplyScalar(this.moveSpeed * dt);
        this.camera.position.add(velocity);
      }
    }

    // Update preview
    if (this.selectedObjectType) {
      this.updatePreview();
    }

    // Update selection circle to face camera
    if (this.selectionCircle.visible) {
      this.updateSelectionCircle();
    }
  }

  enter() {
    // Show edit UI
    document.getElementById('edit-ui').classList.remove('hidden');
    document.getElementById('ui').classList.add('hidden');
    document.getElementById('start-menu').classList.add('hidden');

    // Set camera to edit position (diagonal opposite corner from second floor, looking at ground center)
    // Second floor is at (-2.5, 5, -2.5), so camera goes to opposite corner
    this.camera.position.set(3, 6, 3);

    // Use lookAt to orient camera toward ground center, then extract yaw/pitch
    const lookAtTarget = new THREE.Vector3(0, 0, 0);
    this.camera.lookAt(lookAtTarget);

    // Extract yaw and pitch from the camera's current rotation
    // Camera rotation order is YXZ
    this.camera.rotation.order = 'YXZ';
    this.yaw = this.camera.rotation.y;
    this.pitch = this.camera.rotation.x;

    // Add mouse look event listeners (only active in edit mode)
    this.renderer.domElement.addEventListener("mousedown", this.boundMouseDown);
    this.renderer.domElement.addEventListener("mouseup", this.boundMouseUp);

    // Add transform controls back to scene and enable them
    if (!this.transformControls.parent) {
      this.scene.add(this.transformControls);
    }
    this.transformControls.enabled = true;
    // Don't show gizmos until an object is selected
    this.transformControls.visible = false;
    this.transformControls.detach(); // Make sure nothing is attached

    // Show default objects for reference
    this.showDefaultObjects();
  }

  exit() {
    // Hide edit UI
    document.getElementById('edit-ui').classList.add('hidden');

    // Show start menu
    document.getElementById('start-menu').classList.remove('hidden');

    // Clear preview
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh = null;
    }

    // Clear selection
    this.selectedObjectType = null;
    this.deselectObject();
    document.querySelectorAll('[data-type]').forEach(b => b.classList.remove('active'));

    // Remove mouse look event listeners (so they don't interfere with play mode)
    this.renderer.domElement.removeEventListener("mousedown", this.boundMouseDown);
    this.renderer.domElement.removeEventListener("mouseup", this.boundMouseUp);

    // Disable mouse look
    this.isMouseLookActive = false;
    document.exitPointerLock();

    // Completely disable and hide transform controls
    this.transformControls.detach(); // Detach from any object
    this.transformControls.visible = false;
    this.transformControls.enabled = false;
    // Remove from scene to prevent any interaction in play mode
    if (this.transformControls.parent) {
      this.scene.remove(this.transformControls);
    }

    // Hide default objects
    this.hideDefaultObjects();
  }

  setLevelBuilder(levelBuilder) {
    this.levelBuilder = levelBuilder;
  }

  setDefaultCube(cube) {
    this.defaultCube = cube;
  }

  setDefaultSpawner(spawner) {
    this.defaultSpawner = spawner;
  }

  showDefaultObjects() {
    // Show default level objects in edit mode for reference
    if (this.levelBuilder) {
      const goal = this.levelBuilder.getGoal();
      if (goal) goal.visible = true;

      const secondFloor = this.levelBuilder.secondFloor;
      if (secondFloor) secondFloor.visible = true;
    }

    if (this.defaultCube) {
      this.defaultCube.visible = true;
    }

    if (this.defaultSpawner) {
      this.defaultSpawner.visible = true;
      // Ensure all children are also visible
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
  }

  hideDefaultObjects() {
    // Hide default objects when leaving edit mode
    if (this.levelBuilder) {
      const goal = this.levelBuilder.getGoal();
      if (goal) goal.visible = false;

      const secondFloor = this.levelBuilder.secondFloor;
      if (secondFloor) secondFloor.visible = false;
    }

    if (this.defaultCube) {
      this.defaultCube.visible = false;
    }

    if (this.defaultSpawner) {
      this.defaultSpawner.visible = false;
      // Explicitly hide children as well
      this.defaultSpawner.traverse((child) => {
        if (child.isMesh) {
          child.visible = false;
        }
      });
    }
  }

  getPlacedObjects() {
    return this.objects;
  }

  getSpawnerPosition() {
    const spawner = this.objects.find(obj => obj.userData.spawner);
    return spawner ? spawner.position.clone() : null;
  }

  getGoals() {
    return this.objects.filter(obj => obj.userData.goal);
  }

  clearAllObjects() {
    this.objects.forEach(obj => this.scene.remove(obj));
    this.objects = [];
  }

  selectObjectAtCursor() {
    // Use raycaster to find object at mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Create array of all selectable objects (editor-placed + default objects)
    const selectableObjects = [...this.objects];

    // Add default objects if they're visible
    if (this.defaultCube && this.defaultCube.visible) {
      selectableObjects.push(this.defaultCube);
    }
    if (this.defaultSpawner && this.defaultSpawner.visible) {
      selectableObjects.push(this.defaultSpawner);
    }
    if (this.levelBuilder) {
      const goal = this.levelBuilder.getGoal();
      if (goal && goal.visible) selectableObjects.push(goal);

      const secondFloor = this.levelBuilder.secondFloor;
      if (secondFloor && secondFloor.visible) selectableObjects.push(secondFloor);
    }

    const intersects = this.raycaster.intersectObjects(selectableObjects, true);

    if (intersects.length > 0) {
      // Find the top-level object (not a child mesh)
      let obj = intersects[0].object;
      while (obj.parent && !selectableObjects.includes(obj)) {
        obj = obj.parent;
      }
      this.selectObject(obj);
    } else {
      this.deselectObject();
    }
  }

  selectObject(obj) {
    this.selectedObject = obj;
    this.transformControls.attach(obj);

    // Use fixed gizmo size regardless of object size
    this.transformControls.setSize(1.0);

    // Apply current tool mode
    if (this.currentToolMode === 'select') {
      this.transformControls.visible = false;
      this.transformControls.enabled = false; // Disable transform interaction in select mode
      this.selectionCircle.visible = true;
      this.updateSelectionCircle();
    } else {
      this.selectionCircle.visible = false;
      this.transformControls.enabled = true; // Enable transform interaction
      this.setTransformMode(this.currentToolMode);
    }

    // Clear placement mode when selecting an object
    this.selectedObjectType = null;
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      this.previewMesh = null;
    }
    document.querySelectorAll('[data-type]').forEach(b => b.classList.remove('active'));
  }

  deselectObject() {
    this.selectedObject = null;
    this.transformControls.detach();
    this.transformControls.visible = false; // Hide gizmos when nothing is selected
    this.selectionCircle.visible = false; // Hide selection circle when nothing is selected
  }

  setTransformMode(mode) {
    if (!this.selectedObject) return;

    this.transformControls.setMode(mode);
    this.transformControls.visible = true; // Ensure gizmos are visible
  }

  updateTransformModeUI(mode) {
    // Update active state for transform mode buttons
    const buttons = document.querySelectorAll('[data-mode]');
    buttons.forEach(btn => {
      if (btn.dataset.mode === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  deleteSelectedObject() {
    if (!this.selectedObject) return;

    // Remove from scene and objects array
    this.scene.remove(this.selectedObject);
    const index = this.objects.indexOf(this.selectedObject);
    if (index > -1) {
      this.objects.splice(index, 1);
    }

    // Detach transform controls and hide gizmos
    this.transformControls.detach();
    this.transformControls.visible = false;
    this.selectedObject = null;
  }
}
