import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { CONFIG } from "./config.js";

/**
 * EditMode - Level editor with god camera and object placement
 */
export class EditMode {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    // God camera controls - use OrbitControls for free camera movement
    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 100;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.enabled = false; // Disabled by default (only enabled in edit mode)

    // Transform controls for gizmos
    this.transformControls = new TransformControls(camera, renderer.domElement);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
    });
    this.transformControls.visible = false; // Hidden by default
    this.transformControls.enabled = false; // Disabled by default
    this.scene.add(this.transformControls);
    this.selectedObject = null;

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
    this.placementGrid = 1.0; // Grid snapping size
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
        case "KeyW": this.moveState.forward = true; break;
        case "KeyS": this.moveState.backward = true; break;
        case "KeyA": this.moveState.left = true; break;
        case "KeyD": this.moveState.right = true; break;
        case "Space": this.moveState.up = true; e.preventDefault(); break;
        case "ShiftLeft": this.moveState.down = true; break;
        case "KeyT": this.setTransformMode('translate'); break;
        case "KeyR": this.setTransformMode('rotate'); break;
        case "KeyE": this.setTransformMode('scale'); break;
        case "Delete": case "Backspace": this.deleteSelectedObject(); e.preventDefault(); break;
        case "Escape": this.deselectObject(); break;
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

    // Mouse move for preview
    this.renderer.domElement.addEventListener("mousemove", (e) => {
      // Update mouse position
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (this.selectedObjectType) {
        this.updatePreview();
      }
    });
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
        this.setTransformMode(btn.dataset.mode);
        // Update active state
        transformButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
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

  createGridTexture(baseColor, divisions = 3) {
    const textureSize = 512;
    const canvas = document.createElement('canvas');
    canvas.width = textureSize;
    canvas.height = textureSize;
    const ctx = canvas.getContext('2d');

    // Draw base color
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, textureSize, textureSize);

    // Draw grid
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;

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
      // Use chamber wall color (neutral gray) with grid
      const texture = this.createGridTexture('#cccccc', 5);
      material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.0
      });
    } else {
      material = new THREE.MeshStandardMaterial({
        color: 0x666666,
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
      // Use second floor grid texture with same color and divisions
      const texture = this.createGridTexture('#dddddd', 5);
      material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.0
      });
    } else {
      material = new THREE.MeshStandardMaterial({
        color: 0x666666,
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
    const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const material = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      roughness: 0.6,
      metalness: 0.0
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.dynamic = true;
    mesh.userData.editorPlaced = true;
    return mesh;
  }

  createGoal(position) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffff00,
      roughness: 0.4,
      metalness: 0.1,
      emissive: 0xffff00,
      emissiveIntensity: 0.3
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
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

    const geometry = new THREE.CylinderGeometry(0.3, 0.3, 1.6, 16);
    const material = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      roughness: 0.5,
      metalness: 0.2,
      emissive: 0x00ff00,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.8
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.spawner = true;
    mesh.userData.editorPlaced = true;
    return mesh;
  }

  update(dt) {
    // Update OrbitControls
    this.controls.update();

    // WASD fly-through movement
    const velocity = new THREE.Vector3();

    if (this.moveState.forward || this.moveState.backward ||
        this.moveState.left || this.moveState.right ||
        this.moveState.up || this.moveState.down) {

      // Get camera direction
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);

      // Get right vector
      const right = new THREE.Vector3();
      right.crossVectors(direction, this.camera.up).normalize();

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
        this.controls.target.add(velocity);
      }
    }

    // Update preview
    if (this.selectedObjectType) {
      this.updatePreview();
    }
  }

  enter() {
    // Show edit UI
    document.getElementById('edit-ui').classList.remove('hidden');
    document.getElementById('ui').classList.add('hidden');
    document.getElementById('start-menu').classList.add('hidden');

    // Set camera to edit position
    this.camera.position.set(0, 10, 15);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    // Enable orbit controls for edit mode
    this.controls.enabled = true;

    // Add transform controls back to scene and enable them
    if (!this.transformControls.parent) {
      this.scene.add(this.transformControls);
    }
    this.transformControls.visible = true;
    this.transformControls.enabled = true;

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

    // Disable orbit controls when leaving edit mode
    this.controls.enabled = false;

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

    // Adjust gizmo size based on object size
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    // Scale gizmo relative to object size (larger objects = larger gizmos)
    this.transformControls.setSize(maxDim * 0.7);

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
  }

  setTransformMode(mode) {
    if (!this.selectedObject) return;

    this.transformControls.setMode(mode);
  }

  deleteSelectedObject() {
    if (!this.selectedObject) return;

    // Remove from scene and objects array
    this.scene.remove(this.selectedObject);
    const index = this.objects.indexOf(this.selectedObject);
    if (index > -1) {
      this.objects.splice(index, 1);
    }

    // Detach transform controls
    this.transformControls.detach();
    this.selectedObject = null;
  }
}
