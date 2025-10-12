import * as THREE from "three";

// Create grid texture for cube
function createCubeGridTexture() {
  const textureSize = 100;
  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d');

  // Draw base color (gray)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, textureSize, textureSize);

  // Draw grid
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 4;
  ctx.globalAlpha = 1.0;


  let div = 2
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
  return texture;
}

export class PhysicsCube extends THREE.Mesh {
  constructor(size = 0.2) {
    const texture = createCubeGridTexture();
    super(new THREE.BoxGeometry(size, size, size),
      new THREE.MeshStandardMaterial({
        color: "#00ffff",
        map: texture,
        roughness: 0.6,
        metalness: 0.0
      }));
    this.castShadow = true; this.receiveShadow = true;
    this.size = size;
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.userData.dynamic = true;
    
    this.isGrabbed = false; // Add state flag for grabbing
    this.portalCooldown = 0; this._lastDebug = 0;
  }

  update(dt, chamberBounds, portals, obstacles = []) {
    if (this.isGrabbed) {
      // Physics suspended when grabbed. Position is controlled by camera in main.js
      return;
    }
    this.portalCooldown = Math.max(0, this.portalCooldown - dt);

    // Gravity
    this.velocity.y -= 9.8 * dt;

    // Integrate
    const prev = this.position.clone();
    this.position.addScaledVector(this.velocity, dt);
    const next = this.position.clone();

    // Portal traversal: swept-sphere against portal plane, then aperture check
    for (const p of portals) {
      if (!p.isPlaced || !p.linked?.isPlaced) continue;
      if (this.portalCooldown > 0) {
        const near = Math.min(
          Math.abs(p.signedDistanceWorld(prev)),
          Math.abs(p.signedDistanceWorld(next))
        ) < 1.2;
        if (near && performance.now() - this._lastDebug > 200) {
          console.debug("[PortalCube] skip due to cooldown", { portalColor: p.color.getHexString(), cooldown: this.portalCooldown.toFixed(2) });
          this._lastDebug = performance.now();
        }
        continue;
      }

      const n = new THREE.Vector3(0,0,1).applyQuaternion(p.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const center = p.getWorldPosition(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, center);
      const d0 = plane.distanceToPoint(prev), d1 = plane.distanceToPoint(next);
      const half = this.size * 0.5;

      const crossesFront = (d0 >  half && d1 <=  half);
      const crossesBack  = (d0 < -half && d1 >= -half);
      if (!(crossesFront || crossesBack)) {
        const near = Math.min(Math.abs(d0), Math.abs(d1)) < 1.2;
        if (near && performance.now() - this._lastDebug > 200) {
          console.debug("[PortalCube] no plane crossing", { portalColor: p.color.getHexString(), d0: d0.toFixed(3), d1: d1.toFixed(3), half: half.toFixed(3) });
          this._lastDebug = performance.now();
        }
        continue;
      }

      const target = d0 > 0 ? half : -half;
      const denom = (d1 - d0);
      const t = denom !== 0 ? THREE.MathUtils.clamp((target - d0) / denom, 0, 1) : 0.0;
      const hitPoint = prev.clone().lerp(next, t);

      const off = hitPoint.clone().sub(center).sub(n.clone().multiplyScalar(hitPoint.clone().sub(center).dot(n)));
      if (off.length() > p.radius) {
        if (performance.now() - this._lastDebug > 200) {
          console.debug("[PortalCube] miss aperture", { portalColor: p.color.getHexString(), off: off.length().toFixed(3), radius: p.radius.toFixed(3) });
          this._lastDebug = performance.now();
        }
        continue;
      }

      const { position, velocity } = p.transformThrough({ position: hitPoint, quaternion: this.quaternion, velocity: this.velocity });
      const exitN = new THREE.Vector3(0,0,1).applyQuaternion(p.linked.getWorldQuaternion(new THREE.Quaternion())).normalize();
      this.position.copy(position).addScaledVector(exitN, half + 0.01);
      this.velocity.copy(velocity);
      this.portalCooldown = 0.15;
      break;
    }

    // Axis-aligned bounds (simple chamber)
    const min = chamberBounds.min, max = chamberBounds.max;
    const half = this.size / 2;

    if (this.position.x - half < min.x) { this.position.x = min.x + half; this.velocity.x *= -0.4; }
    if (this.position.x + half > max.x) { this.position.x = max.x - half; this.velocity.x *= -0.4; }
    if (this.position.y - half < min.y) { this.position.y = min.y + half; this.velocity.y *= -0.2; }
    if (this.position.y + half > max.y) { this.position.y = max.y - half; this.velocity.y *= -0.4; }
    if (this.position.z - half < min.z) { this.position.z = min.z + half; this.velocity.z *= -0.4; }
    if (this.position.z + half > max.z) { this.position.z = max.z - half; this.velocity.z *= -0.4; }

    // Ground friction: damp horizontal motion when resting on floor
    if (this.position.y - half <= min.y + 1e-4) {
      const mu = 6.0; // strong friction
      const f = Math.max(0, 1 - mu * dt);
      this.velocity.x *= f;
      this.velocity.z *= f;
    }

    // Obstacle collisions (second floor, door) - simple AABB push-out
    let onTopSurface = false;
    for (const obj of obstacles) {
      const box = new THREE.Box3().setFromObject(obj);
      const expanded = box.clone().expandByScalar(half);
      if (expanded.containsPoint(this.position)) {
        const dMin = expanded.max.clone().sub(this.position);
        const dMax = this.position.clone().sub(expanded.min);
        const pen = new THREE.Vector3(
          Math.min(dMin.x, dMax.x),
          Math.min(dMin.y, dMax.y),
          Math.min(dMin.z, dMax.z)
        );
        const axis = pen.x < pen.y && pen.x < pen.z ? 'x' : (pen.y < pen.z ? 'y' : 'z');
        const dir = (this.position[axis] - (expanded.min[axis] + expanded.max[axis]) * 0.5) >= 0 ? 1 : -1;
        this.position[axis] += pen[axis] * dir;
        this.velocity[axis] *= -0.3;
        if (axis === 'y' && dir > 0) onTopSurface = true;
      }
    }
    
    // Apply same friction when resting on top of second-floor platform
    if (onTopSurface) {
      const mu = 6.0, f = Math.max(0, 1 - mu * dt);
      this.velocity.x *= f; this.velocity.z *= f;
    }
  }
}