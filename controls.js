import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

export class FPSController {
  constructor(camera, domElement) {
    this.controls = new PointerLockControls(camera, domElement);
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.enabled = false;
    this.isMobile = window.matchMedia('(pointer: coarse)').matches;

    this.moveFwd = false; this.moveBack = false; this.moveLeft = false; this.moveRight = false;
    this.canJump = true;
    this.speed = 4.5; // m/s
    this.jumpVel = 5.5;
    this.gravity = 9.8;

    if (!this.isMobile) {
      domElement.addEventListener("click", () => this.controls.lock());
      this.controls.addEventListener("lock", () => (this.enabled = true));
      this.controls.addEventListener("unlock", () => (this.enabled = false));
    } else {
      this.enabled = true; // Mobile: no pointer lock; enable movement by default
    }

    const onKeyDown = (e) => {
      switch (e.code) {
        case "KeyW": this.moveFwd = true; break;
        case "KeyS": this.moveBack = true; break;
        case "KeyA": this.moveLeft = true; break;
        case "KeyD": this.moveRight = true; break;
        case "Space": if (this.canJump) { this.velocity.y = this.jumpVel; this.canJump = false; } break;
      }
    };
    const onKeyUp = (e) => {
      switch (e.code) {
        case "KeyW": this.moveFwd = false; break;
        case "KeyS": this.moveBack = false; break;
        case "KeyA": this.moveLeft = false; break;
        case "KeyD": this.moveRight = false; break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
  }

  get object() { return this.controls.getObject(); }

  update(dt, collisionFn) {
    if (!this.enabled) return;

    // Horizontal movement
    this.direction.set(0, 0, 0);
    if (this.moveFwd) this.direction.z -= 1;
    if (this.moveBack) this.direction.z += 1;
    if (this.moveLeft) this.direction.x -= 1;
    if (this.moveRight) this.direction.x += 1;
    this.direction.normalize();

    // Get player's forward direction and project it to horizontal plane (xz)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.object.quaternion);
    forward.y = 0; // Project to horizontal plane
    forward.normalize();

    // Get player's right direction (also horizontal)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.object.quaternion);
    right.y = 0; // Project to horizontal plane
    right.normalize();

    // Calculate horizontal movement based on input
    const move = new THREE.Vector3();
    move.addScaledVector(forward, -this.direction.z); // Forward/back
    move.addScaledVector(right, this.direction.x);     // Left/right
    move.multiplyScalar(this.speed);

    // Gravity
    this.velocity.y -= this.gravity * dt;

    // Apply movement
    const delta = new THREE.Vector3(move.x * dt, this.velocity.y * dt, move.z * dt);
    const newPos = this.object.position.clone().add(delta);

    // Collision resolution via callback
    const resolved = collisionFn ? collisionFn(this.object.position, newPos) : newPos;
    this.object.position.copy(resolved);

    // Ground check
    if (resolved.y <= 1.0) { // floor height
      this.velocity.y = 0; this.canJump = true; this.object.position.y = 1.0;
    }
  }
}