import * as THREE from "three";
import { CONFIG } from "./config.js";

/**
 * PlayerController - Handles player collision, portal traversal, and orientation correction
 */
export class PlayerController {
  constructor(fps, chamberBounds, obstacles) {
    this.fps = fps;
    this.chamberBounds = chamberBounds;
    this.obstacles = obstacles;

    // Orientation correction for horizontal portals
    this.orientationCorrection = null;

    // Portal cooldown to prevent instant re-teleport
    this.portalCooldown = 0;
  }

  /**
   * Update obstacles list (e.g., when adding editor-placed objects)
   */
  setObstacles(obstacles) {
    this.obstacles = obstacles;
  }

  /**
   * Add obstacles to existing list
   */
  addObstacles(newObstacles) {
    this.obstacles = [...this.obstacles, ...newObstacles];
  }

  /**
   * Resolve player collision and portal traversal
   */
  resolvePlayerCollision(prev, next, portals, dt) {
    // Update cooldown
    this.portalCooldown = Math.max(0, this.portalCooldown - dt);

    // Clamp to chamber bounds
    const pos = next.clone();
    pos.x = THREE.MathUtils.clamp(pos.x, this.chamberBounds.min.x + CONFIG.player.radius, this.chamberBounds.max.x - CONFIG.player.radius);
    pos.y = Math.max(pos.y, CONFIG.player.minHeight);
    pos.z = THREE.MathUtils.clamp(pos.z, this.chamberBounds.min.z + CONFIG.player.radius, this.chamberBounds.max.z - CONFIG.player.radius);

    // Portal crossing
    for (const p of portals) {
      if (!p.isPlaced || !p.linked?.isPlaced) continue;

      // Skip if in cooldown period
      if (this.portalCooldown > 0) continue;

      const portalPos = p.getWorldPosition(new THREE.Vector3());
      const portalNormal = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(p.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();

      // Use planar distance for horizontal portals
      const isHorizontal = Math.abs(portalNormal.y) > CONFIG.traversal.horizontalThreshold;
      const toPlayer = pos.clone().sub(portalPos);
      const distanceAlongNormal = toPlayer.dot(portalNormal);
      const off = toPlayer.sub(portalNormal.clone().multiplyScalar(distanceAlongNormal));
      const planarDist = off.length();

      // Determine portal type early to apply different distance checks
      const isFloor = isHorizontal && portalNormal.y > 0;
      const isCeiling = isHorizontal && portalNormal.y < 0;

      const triggerDistance = isHorizontal
        ? p.radius * CONFIG.traversal.floorTriggerDistance
        : p.radius * CONFIG.traversal.wallTriggerDistance;

      // Distance check: horizontal portals require both planar and vertical proximity
      let inRange = false;
      if (isCeiling) {
        // For ceiling: must be close in xz plane AND close vertically (within 1.5m below ceiling)
        const verticalDist = Math.abs(distanceAlongNormal);
        inRange = planarDist < triggerDistance && verticalDist < 1.5;
      } else if (isFloor) {
        // For floor: must be close in xz plane AND close vertically (within 1.0m above floor)
        const verticalDist = Math.abs(distanceAlongNormal);
        inRange = planarDist < triggerDistance && verticalDist < 1.0;
      } else {
        // For walls: use 3D distance
        inRange = pos.distanceTo(portalPos) < triggerDistance;
      }

      if (inRange) {
        const moveDir = new THREE.Vector3().subVectors(pos, prev);
        if (moveDir.lengthSq() < 0.001) continue;
        moveDir.normalize();

        const dotProduct = moveDir.dot(portalNormal);

        // Foot collider and grounded state
        const footPos = pos.clone();
        footPos.y = CONFIG.player.minHeight;
        const grounded = pos.y <= CONFIG.player.groundedThreshold;

        let shouldTrigger = false;

        if (isFloor) {
          const toFoot = footPos.clone().sub(portalPos);
          const off = toFoot.sub(portalNormal.clone().multiplyScalar(toFoot.dot(portalNormal)));
          const insideAperture = off.length() <= p.radius * CONFIG.traversal.floorApertureMultiplier;
          shouldTrigger = (grounded && insideAperture) || (dotProduct < CONFIG.traversal.dotProductThreshold.floor);
        } else if (isCeiling) {
          // Ceiling portal should ONLY trigger when player has upward velocity (jumping/flying up)
          const hasUpwardVelocity = this.fps.velocity.y > CONFIG.traversal.ceilingVelocityThreshold;

          // Additional check: player must be moving TOWARD the portal (not away from it)
          // For ceiling portal (normal pointing down), velocity should point upward INTO the portal
          // This means the dot product of velocity and portal normal should be negative
          const velocityDotNormal = this.fps.velocity.dot(portalNormal);
          const movingTowardPortal = velocityDotNormal < -0.1;

          shouldTrigger = hasUpwardVelocity && movingTowardPortal;
        } else {
          shouldTrigger = dotProduct < CONFIG.traversal.dotProductThreshold.wall;
        }

        if (shouldTrigger) {
          const transformed = p.transformThrough({
            position: pos,
            quaternion: this.fps.object.quaternion.clone(),
            velocity: this.fps.velocity.clone()
          });

          // Offset out of exit portal plane
          const exitNormal = new THREE.Vector3(0, 0, 1)
            .applyQuaternion(p.linked.getWorldQuaternion(new THREE.Quaternion()))
            .normalize();
          const exitPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            exitNormal,
            p.linked.getWorldPosition(new THREE.Vector3())
          );

          const outPos = transformed.position.clone();
          const dist = exitPlane.distanceToPoint(outPos);
          if (dist < CONFIG.player.radius + 0.001) {
            outPos.addScaledVector(exitNormal, (CONFIG.player.radius + CONFIG.traversal.playerOffsetDistance) - dist);
          }

          this.fps.object.position.copy(outPos);
          this.fps.object.quaternion.copy(transformed.quaternion);
          this.fps.velocity.copy(transformed.velocity);

          // Check if exit portal is horizontal
          const linkedNormal = new THREE.Vector3(0, 0, 1)
            .applyQuaternion(p.linked.getWorldQuaternion(new THREE.Quaternion()))
            .normalize();
          const exitIsHorizontal = Math.abs(linkedNormal.y) > CONFIG.traversal.horizontalThreshold;

          if (exitIsHorizontal) {
            // Check if player is upside down (up vector pointing down)
            const playerUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.fps.object.quaternion);
            const isUpsideDown = playerUp.y < 0;

            // Only apply orientation correction if player is upside down
            if (isUpsideDown) {
              this.orientationCorrection = {
                startQuat: this.fps.object.quaternion.clone(),
                startTime: performance.now(),
                duration: CONFIG.traversal.orientationCorrectionDuration
              };
            }
          }

          // Set cooldown to prevent immediate re-teleport (0.2 seconds)
          this.portalCooldown = 0.2;

          return this.fps.object.position.clone();
        }
      }
    }

    // Resolve against obstacle AABBs
    for (const obj of this.obstacles) {
      const box = new THREE.Box3().setFromObject(obj);
      const r = CONFIG.player.radius;
      const expanded = box.clone().expandByScalar(r);

      if (expanded.containsPoint(pos)) {
        const dMin = expanded.max.clone().sub(pos);
        const dMax = pos.clone().sub(expanded.min);
        const pen = new THREE.Vector3(
          Math.min(dMin.x, dMax.x),
          Math.min(dMin.y, dMax.y),
          Math.min(dMin.z, dMax.z)
        );

        const axis = pen.x < pen.y && pen.x < pen.z ? 'x' : (pen.y < pen.z ? 'y' : 'z');
        const dir = (pos[axis] - (expanded.min[axis] + expanded.max[axis]) * 0.5) >= 0 ? 1 : -1;
        pos[axis] += pen[axis] * dir;

        if (axis === 'y' && dir > 0) {
          this.fps.velocity.y = Math.max(0, this.fps.velocity.y);
        }
      }
    }

    return pos;
  }

  /**
   * Apply orientation correction (smooth rotation after horizontal portal exit)
   */
  updateOrientationCorrection() {
    if (!this.orientationCorrection) return;

    const elapsed = performance.now() - this.orientationCorrection.startTime;
    const progress = Math.min(elapsed / this.orientationCorrection.duration, 1.0);

    // Ease-out cubic
    const easedT = 1 - Math.pow(1 - progress, 3);

    // Get current forward direction
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientationCorrection.startQuat);
    forward.y = 0;

    if (forward.lengthSq() > 0.001) {
      forward.normalize();

      // Target: Y-up orientation
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(up, forward).normalize();
      const correctedUp = new THREE.Vector3().crossVectors(forward, right);
      const rotMatrix = new THREE.Matrix4().makeBasis(right, correctedUp, forward.negate());
      const targetQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

      // Slerp to target
      this.fps.object.quaternion.slerpQuaternions(
        this.orientationCorrection.startQuat,
        targetQuat,
        easedT
      );
      this.orientationCorrection.startQuat.copy(this.fps.object.quaternion);
    }

    if (progress >= 1.0) {
      this.orientationCorrection = null;
    }
  }

  /**
   * Apply continuous up-vector recovery (roll damping)
   */
  applyUpVectorRecovery(camera) {
    // Damp local Z (roll) toward zero
    const recovery = CONFIG.orientation.rollRecoverySpeed;
    const objEuler = new THREE.Euler().setFromQuaternion(this.fps.object.quaternion, 'YXZ');
    objEuler.z = THREE.MathUtils.lerp(objEuler.z, 0, recovery);
    this.fps.object.quaternion.setFromEuler(objEuler);

    // Rotate camera around player forward to recover up vector
    const playerFwd = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(this.fps.object.quaternion)
      .normalize();
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const worldUp = new THREE.Vector3(0, 1, 0);

    const upProjCurrent = camUp.clone()
      .sub(playerFwd.clone().multiplyScalar(camUp.dot(playerFwd)))
      .normalize();

    const upProjTarget = (() => {
      const p = worldUp.clone().sub(playerFwd.clone().multiplyScalar(worldUp.dot(playerFwd)));
      return p.lengthSq() > 1e-6 ? p.normalize() : upProjCurrent.clone();
    })();

    const cross = new THREE.Vector3().crossVectors(upProjCurrent, upProjTarget);
    const angle = Math.atan2(playerFwd.dot(cross), upProjCurrent.dot(upProjTarget));
    const qCorr = new THREE.Quaternion().setFromAxisAngle(
      playerFwd,
      THREE.MathUtils.clamp(angle, -CONFIG.orientation.maxAngleStep, CONFIG.orientation.maxAngleStep) *
      CONFIG.orientation.upRecoverySpeed
    );
    camera.quaternion.premultiply(qCorr);
  }

  /**
   * Reset orientation correction
   */
  reset() {
    this.orientationCorrection = null;
  }
}
