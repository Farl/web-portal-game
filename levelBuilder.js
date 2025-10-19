import * as THREE from "three";
import { CONFIG } from "./config.js";

/**
 * LevelBuilder - Handles room/chamber construction with grid textures
 */
export class LevelBuilder {
  constructor(scene) {
    this.scene = scene;
    this.chamber = new THREE.Group();
    this.scene.add(this.chamber);

    const halfRoomScale = CONFIG.room.scale / 2.0;
    const halfWallThickness = CONFIG.room.wallThickness / 2.0;

    this.chamberBounds = new THREE.Box3(
      new THREE.Vector3(-halfRoomScale, 0, -halfRoomScale),
      new THREE.Vector3(halfRoomScale, CONFIG.room.scale, halfRoomScale)
    );

    this.obstacles = [];
    this.secondFloor = null;
    this.goal = null;
  }

  /**
   * Creates a procedural grid texture
   */
  createGridTexture(baseColor, gridColor = CONFIG.texture.gridColor, divisions = CONFIG.room.gridDivisions, opacity = CONFIG.room.gridOpacity) {
    const textureSize = CONFIG.texture.gridSize;
    const canvas = document.createElement('canvas');
    canvas.width = textureSize;
    canvas.height = textureSize;
    const ctx = canvas.getContext('2d');

    // Draw base color
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, textureSize, textureSize);

    // Draw grid
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = CONFIG.texture.gridLineWidth;
    ctx.globalAlpha = opacity;

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

  /**
   * Creates a wall mesh
   */
  makeWall(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, color = 0xf0f0f0, withGrid = false, castShadow = false) {
    const geo = new THREE.BoxGeometry(w, h, d);
    let mat;

    if (withGrid) {
      const colorHex = '#' + color.toString(16).padStart(6, '0');
      const texture = this.createGridTexture(colorHex, CONFIG.texture.gridColor, Math.max(w, h, d));
      mat = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.9,
        metalness: 0.0
      });
    } else {
      mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.0 });
    }

    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.receiveShadow = true;
    m.castShadow = castShadow;
    m.userData.portalable = true;
    this.chamber.add(m);
    return m;
  }

  /**
   * Builds the entire test chamber
   */
  buildChamber() {
    const { scale, wallThickness, colors, gridEnabled } = CONFIG.room;
    const halfRoomScale = scale / 2.0;
    const halfWallThickness = wallThickness / 2.0;

    // Walls
    this.makeWall(
      scale, scale, wallThickness,
      0, halfRoomScale, -halfRoomScale - halfWallThickness,
      0, 0, 0, colors.back, gridEnabled
    ); // back - red

    this.makeWall(
      scale, scale, wallThickness,
      0, halfRoomScale, halfRoomScale + halfWallThickness,
      0, 0, 0, colors.front, gridEnabled
    ); // front - blue

    this.makeWall(
      wallThickness, scale, scale,
      -halfRoomScale - halfWallThickness, halfRoomScale, 0,
      0, 0, 0, colors.left, gridEnabled
    ); // left - green

    this.makeWall(
      wallThickness, scale, scale,
      halfRoomScale + halfWallThickness, halfRoomScale, 0,
      0, 0, 0, colors.right, gridEnabled
    ); // right - yellow

    // Floor
    this.makeWall(
      scale, wallThickness, scale,
      0, -halfWallThickness, 0,
      0, 0, 0, colors.floor, gridEnabled
    );

    // Ceiling
    this.makeWall(
      scale, wallThickness, scale,
      0, scale, 0,
      0, 0, 0, colors.ceiling, gridEnabled
    );

    // Second floor platform (hidden by default, only shown if no editor platform exists)
    const secondFloorHeight = CONFIG.room.secondFloorHeight;
    this.secondFloor = this.makeWall(
      halfRoomScale, wallThickness, halfRoomScale,
      -halfRoomScale / 2, secondFloorHeight, -halfRoomScale / 2,
      0, 0, 0, colors.secondFloor, gridEnabled, true
    );
    this.secondFloor.visible = false; // Hidden by default

    this.obstacles.push(this.secondFloor);
  }

  /**
   * Creates the goal (door frame with black plane)
   */
  buildGoal() {
    const { scale, secondFloorHeight, colors } = CONFIG.room;
    const halfRoomScale = scale / 2.0;

    // Create door frame group
    const doorGroup = new THREE.Group();

    // Door frame dimensions
    const frameWidth = 1.0;
    const frameHeight = 2.0;
    const frameThickness = 0.1;
    const frameDepth = 0.1;

    // Shared frame material for all 3 frame bars (memory efficient)
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x006400,
      roughness: 0.7,
      metalness: 0.0,
      emissive: 0x006400,
      emissiveIntensity: 0.2
    });

    // Left vertical bar
    const leftBar = new THREE.Mesh(
      new THREE.BoxGeometry(frameThickness, frameHeight, frameDepth),
      frameMaterial
    );
    leftBar.position.set(-frameWidth / 2 - frameThickness / 2, 0, 0);
    leftBar.castShadow = true;
    leftBar.receiveShadow = true;
    doorGroup.add(leftBar);

    // Right vertical bar
    const rightBar = new THREE.Mesh(
      new THREE.BoxGeometry(frameThickness, frameHeight, frameDepth),
      frameMaterial
    );
    rightBar.position.set(frameWidth / 2 + frameThickness / 2, 0, 0);
    rightBar.castShadow = true;
    rightBar.receiveShadow = true;
    doorGroup.add(rightBar);

    // Top horizontal bar
    const topBar = new THREE.Mesh(
      new THREE.BoxGeometry(frameWidth + frameThickness * 2, frameThickness, frameDepth),
      frameMaterial
    );
    topBar.position.set(0, frameHeight / 2 + frameThickness / 2, 0);
    topBar.castShadow = true;
    topBar.receiveShadow = true;
    doorGroup.add(topBar);

    // Black plane in the center (the "portal" area)
    const planeMaterial = new THREE.MeshStandardMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      roughness: 0.1,
      metalness: 0.0
    });
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(frameWidth, frameHeight),
      planeMaterial
    );
    plane.position.set(0, 0, 0);
    plane.name = 'doorPlane';
    doorGroup.add(plane);

    // Position the door frame
    doorGroup.position.set(
      -halfRoomScale / 2.0,
      secondFloorHeight + frameHeight / 2,
      -halfRoomScale / 2.0
    );
    doorGroup.userData.door = true;
    doorGroup.userData.isExitDoor = true;
    doorGroup.userData.goal = true; // Keep for backward compatibility
    doorGroup.visible = false; // Hidden by default

    this.goal = doorGroup;
    this.scene.add(this.goal);
    this.obstacles.push(this.goal);
  }

  /**
   * Build the complete level
   */
  build() {
    this.buildChamber();
    this.buildGoal();
  }

  getChamber() {
    return this.chamber;
  }

  getChamberBounds() {
    return this.chamberBounds;
  }

  getObstacles() {
    return this.obstacles;
  }

  getGoal() {
    return this.goal;
  }
}
