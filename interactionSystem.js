import * as THREE from "three";
import { CONFIG } from "./config.js";

/**
 * InteractionSystem - Handles object grabbing, charging, and throwing
 */
export class InteractionSystem {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    // Grab state
    this.grabbedCube = null;

    // Charge state
    this.chargeActive = false;
    this.chargeStart = 0;
    this.chargeValue = 0;
    this.lastMaxCharge = 0;

    // UI elements
    this.gaugeEl = document.getElementById('throw-gauge');
    this.barEl = document.getElementById('throw-bar');
    this.valEl = document.getElementById('throw-value');

    // Hide gauge initially
    this.gaugeEl.classList.remove('show');
    this.barEl.style.width = '0%';
    this.valEl.textContent = '0 m/s';
  }

  /**
   * Try to grab an object from raycaster hit
   */
  tryGrab(raycaster) {
    if (this.grabbedCube) return false;

    // Collect all meshes that are dynamic (either the object itself or its children)
    const meshesToTest = [];
    this.scene.traverse((obj) => {
      if (obj.isMesh && obj.userData.dynamic) {
        meshesToTest.push(obj);
      }
    });

    const hits = raycaster.intersectObjects(meshesToTest, false);
    const hit = hits[0];

    if (hit && hit.distance <= CONFIG.interaction.grabCheckDistance) {
      // Find the root dynamic object (could be the hit object or its parent)
      let dynamicObject = hit.object;
      while (dynamicObject.parent && !dynamicObject.userData.dynamic) {
        dynamicObject = dynamicObject.parent;
      }

      if (dynamicObject.userData.dynamic) {
        this.grabbedCube = dynamicObject;
        this.grabbedCube.isGrabbed = true;
        if (this.grabbedCube.velocity) {
          this.grabbedCube.velocity.set(0, 0, 0);
        }

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this.grabbedCube.position.copy(
          this.camera.position.clone().addScaledVector(forward, CONFIG.interaction.grabDistance)
        );

        return true;
      }
    }

    return false;
  }

  /**
   * Start charging throw
   */
  startCharge() {
    if (this.grabbedCube && !this.chargeActive) {
      this.chargeActive = true;
      this.chargeStart = performance.now();
      this.chargeValue = 0;
      this.lastMaxCharge = 0;
      this.gaugeEl.classList.add('show');
    }
  }

  /**
   * Release and throw the grabbed object
   */
  releaseThrow(fpsVelocity) {
    if (!this.grabbedCube || !this.chargeActive) return;

    this.lastMaxCharge = 0;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const momentumCarry = fpsVelocity.clone().dot(forward);
    const strength = this.chargeValue * CONFIG.interaction.throwStrength.max;

    this.grabbedCube.velocity.copy(forward).multiplyScalar(strength + Math.max(0, momentumCarry));
    this.grabbedCube.isGrabbed = false;
    this.grabbedCube = null;

    this.chargeActive = false;
    this.chargeValue = 0;

    this.gaugeEl.classList.remove('show');
    this.barEl.style.width = '0%';
    this.valEl.textContent = '0 m/s';
  }

  /**
   * Handle grab/throw toggle
   */
  toggleGrabThrow(raycaster, fpsEnabled, isMobile) {
    if (!fpsEnabled && !isMobile) return;

    if (!this.grabbedCube) {
      this.tryGrab(raycaster);
    }
  }

  /**
   * Update grabbed cube position (smooth follow)
   */
  updateGrabbedCube() {
    if (!this.grabbedCube) return;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const targetWorldPosition = this.camera.position.clone().addScaledVector(
      forward,
      CONFIG.interaction.grabDistance
    );

    // Smoothly move the cube to the target position
    this.grabbedCube.position.lerp(targetWorldPosition, CONFIG.interaction.grabLerpSpeed);

    // Keep cube upright
    this.grabbedCube.rotation.set(0, 0, 0);
  }

  /**
   * Update charge value
   */
  updateCharge() {
    if (!this.chargeActive) return;

    const elapsed = performance.now() - this.chargeStart;
    const { deadzone, total } = CONFIG.interaction.chargeTiming;

    this.chargeValue = Math.min(1, Math.max(0, (elapsed - deadzone) / (total - deadzone)));
  }

  /**
   * Update throw gauge UI
   */
  updateGaugeUI() {
    if (this.chargeActive) {
      const percentage = (this.chargeValue * 100).toFixed(0) + '%';
      const velocity = Math.round(this.chargeValue * CONFIG.interaction.throwStrength.max);

      this.barEl.style.width = percentage;
      this.valEl.textContent = velocity + ' m/s';
    }

    const gaugeFill = this.chargeActive ? this.chargeValue : this.lastMaxCharge;
    document.getElementById('throw-bar').style.width = (gaugeFill * 100).toFixed(0) + '%';
    document.getElementById('throw-value').textContent =
      Math.round(gaugeFill * CONFIG.interaction.throwStrength.max) + ' m/s';
  }

  /**
   * Get grabbed cube
   */
  getGrabbedCube() {
    return this.grabbedCube;
  }

  /**
   * Is charging
   */
  isCharging() {
    return this.chargeActive;
  }

  /**
   * Reset grab state
   */
  reset() {
    this.grabbedCube = null;
    this.chargeActive = false;
    this.chargeValue = 0;
    this.lastMaxCharge = 0;
    this.gaugeEl.classList.remove('show');
    this.barEl.style.width = '0%';
    this.valEl.textContent = '0 m/s';
  }
}
