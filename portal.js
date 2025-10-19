import * as THREE from "three";

/**
 * Portal: ellipse with emissive ring, render-to-texture surface, linked to another portal.
 * Visuals use RTT + oblique near-plane clipping to avoid rendering behind exit surface.
 * Traversal and camera transform use: Mvirt = Mplayer * Min(A) * Mout(B) * R180
 */
export class Portal extends THREE.Group {
  constructor({ color = new THREE.Color(0x2a7fff), radius = 0.6, aspect = 1.6 }) {
    super();
    this.userData.portal = true;
    this.radius = radius;
    this.aspect = aspect;
    this.color = color;
    this.isPlaced = false;

    // Portal border ring (visible ring around the edge)
    // Inner radius slightly larger than portal radius to avoid depth occlusion
    const ellipseGeo = new THREE.RingGeometry(radius * 0.9, radius * 1.15, 64, 1, 0, Math.PI * 2);
    const borderMat = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 2,
      roughness: 0.2,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -4
    });
    const border = new THREE.Mesh(ellipseGeo, borderMat);
    border.renderOrder = 1;
    this.add(border);

    // No inner disk needed - stencil rendering draws directly to screen

    // Collision/traversal trigger (thin box in front)
    const triggerGeo = new THREE.BoxGeometry(radius * 1.8, radius * 1.8, 0.08);
    const triggerMat = new THREE.MeshBasicMaterial({ visible: false });
    this.trigger = new THREE.Mesh(triggerGeo, triggerMat);
    this.trigger.position.z = 0.04; // slightly in front
    this.add(this.trigger);

    // Exit link and virtual camera
    this.linked = null;
    this.virtualCam = new THREE.PerspectiveCamera(75, aspect, 0.02, 100);
    // Don't add virtualCam to scene graph - it's just used for rendering

    // Debug: visualize portal normal (points out of the wall)
    this.normalHelper = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), radius * 1.2, this.color.getHex()
    );
    this.normalHelper.visible = false; // Hide by default
    this.add(this.normalHelper);
  }

  link(other) {
    this.linked = other;
    other.linked = this;
  }

  placeAt(hit) {
    // hit: { point, face.normal, object, uv }
    const normal = new THREE.Vector3().copy((hit.face && hit.face.normal) ? hit.face.normal : new THREE.Vector3(0, 0, 1));
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const worldNormal = normal.clone().applyMatrix3(normalMatrix).normalize();

    // Position slightly offset to avoid z-fighting
    this.position.copy(hit.point).addScaledVector(worldNormal, 0.02);

    // Orient so +Z points forward
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
    this.quaternion.copy(quat);

    // Update debug helper
    this.normalHelper.setDirection(new THREE.Vector3(0, 0, 1));
    this.normalHelper.position.set(0, 0, 0);

    this.isPlaced = true;
  }

  // Helper: provide a stencil mask mesh (not parented) and keep it in sync
  createMaskMesh() {
    // Simple material for stencil mask
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff00, // Green for debugging
      side: THREE.DoubleSide, // Render both sides
      depthTest: false // Always visible for debugging
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(this.radius * 0.98, 64), mat);
    mesh.visible = false; // toggled when drawing
    return mesh;
  }

  syncMaskTransform(maskMesh) {
    maskMesh.position.copy(this.getWorldPosition(new THREE.Vector3()));
    maskMesh.quaternion.copy(this.getWorldQuaternion(new THREE.Quaternion()));
    maskMesh.scale.set(1, 1, 1);
  }

  // Compute virtual camera transform from main camera through A->B portals with 180° flip
  updateVirtualCamera(mainCam, playerObj) {
    if (!this.linked || !this.isPlaced || !this.linked.isPlaced) return;

    const A = this, B = this.linked;
    const M_player = mainCam.matrixWorld.clone(), M_entryInv = A.matrixWorld.clone().invert(), M_exit = B.matrixWorld.clone();

    // Determine rotation axis based on portal orientation
    const normalB = new THREE.Vector3(0, 0, 1).applyQuaternion(B.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const isHorizontal = Math.abs(normalB.y) > 0.7; // Portal is on floor/ceiling if normal is mostly vertical

    let rotationAxis;
    if (isHorizontal) {
      // Floor/ceiling portal: rotate around a horizontal axis (portal's local X axis)
      rotationAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(B.getWorldQuaternion(new THREE.Quaternion())).normalize();
    } else {
      // Wall portal: rotate around vertical axis (portal's local Y axis, which points up)
      rotationAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(B.getWorldQuaternion(new THREE.Quaternion())).normalize();
    }

    const R180 = new THREE.Matrix4().makeRotationAxis(rotationAxis, Math.PI);
    const Mv = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().multiplyMatrices(M_exit, R180), new THREE.Matrix4().multiplyMatrices(M_entryInv, M_player));
    Mv.decompose(this.virtualCam.position, this.virtualCam.quaternion, this.virtualCam.scale); this.virtualCam.scale.set(1,1,1);
    this.virtualCam.fov = mainCam.fov; this.virtualCam.aspect = mainCam.aspect; this.virtualCam.near = 0.02; this.virtualCam.updateProjectionMatrix(); this.virtualCam.updateMatrixWorld(true);
    const nWorld = new THREE.Vector3(0,0,1).applyQuaternion(B.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const planePoint = B.getWorldPosition(new THREE.Vector3()).addScaledVector(nWorld, 0.005);
    const planeWorld = new THREE.Plane().setFromNormalAndCoplanarPoint(nWorld, planePoint).normalize(); applyObliqueClipping(this.virtualCam, planeWorld);
  }

  // Old RTT-based rendering removed - now using direct stencil rendering in main.js

  // Signed distance to portal plane in world space
  signedDistanceWorld(point) {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion), this.position
    );
    return plane.distanceToPoint(point);
  }

  // Transform a pose (position/quaternion) and a vector (velocity) across A->B
  transformThrough({ position, quaternion, velocity }) {
    const A = this; const B = this.linked;
    const mAInv = new THREE.Matrix4().copy(A.matrixWorld).invert();
    const mB = new THREE.Matrix4().copy(B.matrixWorld);

    // Determine rotation axis based on portal B's orientation
    const normalB = new THREE.Vector3(0, 0, 1).applyQuaternion(B.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const isHorizontal = Math.abs(normalB.y) > 0.7;

    let rotationAxis;
    if (isHorizontal) {
      rotationAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(B.getWorldQuaternion(new THREE.Quaternion())).normalize();
    } else {
      rotationAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(B.getWorldQuaternion(new THREE.Quaternion())).normalize();
    }

    const rotFlip = new THREE.Matrix4().makeRotationAxis(rotationAxis, Math.PI);
    const X = new THREE.Matrix4().copy(mB).multiply(rotFlip).multiply(mAInv);

    // Transform position
    const newPos = position.clone().applyMatrix4(X);

    // Transform velocity
    const qX = new THREE.Quaternion().setFromRotationMatrix(X);
    const newVel = velocity.clone().applyQuaternion(qX);

    // Transform rotation
    const newQuat = quaternion.clone().premultiply(qX);

    return { position: newPos, quaternion: newQuat, velocity: newVel };
  }
}

/**
 * Modify camera projection with an oblique near-plane clip (Eric Lengyel method).
 * planeWorld: THREE.Plane in world space, clipping everything behind it.
 */
function applyObliqueClipping(camera, planeWorld) {
  // Transform world plane into camera/view space
  const viewMat = camera.matrixWorldInverse.clone();
  const planeCam = planeWorld.clone().applyMatrix4(viewMat).normalize();

  // Ensure plane faces the camera (negative half-space clipped)
  if (planeCam.constant > 0) planeCam.negate();

  const proj = camera.projectionMatrix.clone();
  const m = proj.elements;

  const clip = new THREE.Vector4(planeCam.normal.x, planeCam.normal.y, planeCam.normal.z, planeCam.constant);
  const q = new THREE.Vector4(
    (Math.sign(clip.x) + m[8]) / m[0],
    (Math.sign(clip.y) + m[9]) / m[5],
    -1.0,
    (1.0 + m[10]) / m[14]
  );

  const s = 2.0 / (clip.x * q.x + clip.y * q.y + clip.z * q.z + clip.w * q.w);
  const c = new THREE.Vector4(clip.x * s, clip.y * s, clip.z * s, clip.w * s);

  m[2]  = c.x;
  m[6]  = c.y;
  m[10] = c.z + 1.0;
  m[14] = c.w;

  camera.projectionMatrix.copy(proj);
}