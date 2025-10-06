import * as THREE from "three";

// Create grid texture for cube
function createCubeGridTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Draw base color (gray)
  ctx.fillStyle = '#888888';
  ctx.fillRect(0, 0, 256, 256);

  // Draw grid
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.3;

  const gridSize = 256 / 12; // 12 divisions
  for (let i = 0; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(i * gridSize, 0);
    ctx.lineTo(i * gridSize, 256);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i * gridSize);
    ctx.lineTo(256, i * gridSize);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export class PhysicsCube extends THREE.Mesh {
  constructor(size = 0.6) {
    const texture = createCubeGridTexture();
    super(new THREE.BoxGeometry(size, size, size),
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.6,
        metalness: 0.0
      }));
    this.castShadow = true; this.receiveShadow = true;
    this.size = size;
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.userData.dynamic = true;
  }

  update(dt, chamberBounds, portals) {
    // Gravity
    this.velocity.y -= 9.8 * dt;

    // Integrate
    this.position.addScaledVector(this.velocity, dt);

    // Axis-aligned bounds (simple chamber)
    const min = chamberBounds.min, max = chamberBounds.max;
    const half = this.size / 2;

    // Collide with chamber walls (elastic-ish)
    if (this.position.x - half < min.x) { this.position.x = min.x + half; this.velocity.x *= -0.4; }
    if (this.position.x + half > max.x) { this.position.x = max.x - half; this.velocity.x *= -0.4; }
    if (this.position.y - half < min.y) { this.position.y = min.y + half; this.velocity.y *= -0.2; }
    if (this.position.y + half > max.y) { this.position.y = max.y - half; this.velocity.y *= -0.4; }
    if (this.position.z - half < min.z) { this.position.z = min.z + half; this.velocity.z *= -0.4; }
    if (this.position.z + half > max.z) { this.position.z = max.z - half; this.velocity.z *= -0.4; }

    // Portal traversal: check center crossing plane from front to back
    for (const p of portals) {
      if (!p.isPlaced || !p.linked?.isPlaced) continue;
      const d = p.signedDistanceWorld(this.position);
      const nextPos = this.position.clone().addScaledVector(this.velocity, dt);
      const dNext = p.signedDistanceWorld(nextPos);
      if (d > 0 && dNext < 0) {
        const { position, velocity } = p.transformThrough({
          position: this.position, quaternion: this.quaternion, velocity: this.velocity
        });
        this.position.copy(position);
        this.velocity.copy(velocity);
      }
    }
  }
}

