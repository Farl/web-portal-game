import * as THREE from "three";
import { FPSController } from "./controls.js";
import { Portal } from "./portal.js";
import { PhysicsCube } from "./physics.js";

const canvas = document.getElementById("webgl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.02, 200);
camera.position.set(0, 1.6, 4);
scene.add(camera);

const fps = new FPSController(camera, renderer.domElement);
scene.add(fps.object);

// Orientation correction for horizontal portals (floor/ceiling)
let orientationCorrection = null; // { startQuat, startTime, duration }

// State for interaction
let grabbedCube = null;
const grabDistance = 1.8; // Distance from camera center to cube center
const throwStrength = 15.0; // Initial velocity boost

// Lighting
const hemi = new THREE.HemisphereLight(0xffffff, 0xaaaaaa, 0.6);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(5, 8, 5);
dir.castShadow = true;
scene.add(dir);

// Test chamber: simple room
const chamber = new THREE.Group();
scene.add(chamber);
const chamberBounds = new THREE.Box3(
  new THREE.Vector3(-5.9, 0.1, -5.9),
  new THREE.Vector3(5.9, 5.9, 5.9)
);

// Create grid texture helper function
function createGridTexture(baseColor, gridColor = '#000000', divisions = 24, opacity = 0.25) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Draw base color
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 512, 512);

  // Draw grid
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = opacity;

  const gridSize = 512 / divisions;
  for (let i = 0; i <= divisions; i++) {
    ctx.beginPath();
    ctx.moveTo(i * gridSize, 0);
    ctx.lineTo(i * gridSize, 512);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i * gridSize);
    ctx.lineTo(512, i * gridSize);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function makeWall(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, color = 0xf0f0f0, withGrid = false) {
  const geo = new THREE.BoxGeometry(w, h, d);
  let mat;

  if (withGrid) {
    const colorHex = '#' + color.toString(16).padStart(6, '0');
    const texture = createGridTexture(colorHex);
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
  m.userData.portalable = true;
  chamber.add(m);
  return m;
}
makeWall(12, 12, 0.2, 0, 3, -6, 0, 0, 0, 0xff4d4d, true); // back - red with grid
makeWall(12, 12, 0.2, 0, 3, 6,  0, 0, 0, 0x4d79ff, true); // front - blue with grid
makeWall(0.2, 12, 12, -6, 3, 0, 0, 0, 0, 0x4dff88, true); // left - green with grid
makeWall(0.2, 12, 12, 6,  3, 0, 0, 0, 0, 0xffd24d, true); // right - yellow with grid
const floor = makeWall(12, 0.2, 12, 0,  0, 0, 0, 0, 0, 0xcccccc, true); // floor with grid
makeWall(12, 0.2, 12, 0,  6, 0, 0, 0, 0, 0x999999, true); // ceiling with grid

// Cube
const cube = new PhysicsCube(0.2);
cube.position.set(0, 2, 0);
scene.add(cube);

// Portals
const blue = new Portal({ color: new THREE.Color(0x2a7fff) });
const orange = new Portal({ color: new THREE.Color(0xff7a00) });
scene.add(blue); scene.add(orange);
blue.link(orange);

// Stencil mask scene (contains only portal masks)
const maskScene = new THREE.Scene();
const blueMask = blue.createMaskMesh();
const orangeMask = orange.createMaskMesh();
maskScene.add(blueMask);
maskScene.add(orangeMask);

// Auto-place initial portals on red (back) and blue (front) walls
(function placeInitialPortals() {
  const backWall = chamber.children.find(m => m.userData.portalable && Math.abs(m.position.z + 6) < 1e-3);
  const frontWall = chamber.children.find(m => m.userData.portalable && Math.abs(m.position.z - 6) < 1e-3);
  if (backWall) {
    blue.placeAt({
      object: backWall,
      point: backWall.localToWorld(new THREE.Vector3(0, -2, 0.1)),
      face: { normal: new THREE.Vector3(0, 0, 1) }
    });
  }
  if (frontWall) {
    orange.placeAt({
      object: frontWall,
      point: frontWall.localToWorld(new THREE.Vector3(0, -2, -0.1)),
      face: { normal: new THREE.Vector3(0, 0, -1) }
    });
  }
})();

// Raycaster for placement/grabbing
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function placePortal(e, portal) {
  e.preventDefault();
  if (!fps.enabled) return;

  raycaster.setFromCamera(mouse.set(0, 0), camera); // from crosshair center
  const intersects = raycaster.intersectObjects(chamber.children, false)
    .filter(i => i.object.userData.portalable);
  if (intersects.length === 0) return;

  const hit = intersects[0];
  // Check size margin: avoid placing if near wall edges
  const margin = 0.7;
  const localPoint = hit.point.clone().applyMatrix4(new THREE.Matrix4().copy(hit.object.matrixWorld).invert());
  const geom = hit.object.geometry;
  if (!geom.boundingBox) geom.computeBoundingBox();
  const halfSize = new THREE.Vector3().subVectors(geom.boundingBox.max, geom.boundingBox.min).multiplyScalar(0.5);
  const axes = ["x","y","z"];
  const thinAxis = axes.reduce((minA,a)=> halfSize[a] < halfSize[minA] ? a : minA, "x");
  const thickAxes = axes.filter(a=>a!==thinAxis);
  if (Math.abs(localPoint[thickAxes[0]]) > halfSize[thickAxes[0]] - margin || Math.abs(localPoint[thickAxes[1]]) > halfSize[thickAxes[1]] - margin) return;

  portal.placeAt(hit);
}

renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
renderer.domElement.addEventListener("mousedown", (e) => {
  if (e.button === 0) placePortal(e, blue);
  if (e.button === 2) placePortal(e, orange);
});

// E key listener for grabbing/releasing
window.addEventListener('keydown', (e) => {
  if (e.key === 'e' || e.key === 'E') {
    if (!fps.enabled) return;
    
    if (grabbedCube) {
      // Release/Shoot the cube
      
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      
      // Add player's forward momentum component for velocity carry
      const playerVelocity = fps.velocity.clone();
      const momentumCarry = playerVelocity.dot(forward); 
      
      grabbedCube.velocity.copy(forward).multiplyScalar(throwStrength + Math.max(0, momentumCarry));
      
      grabbedCube.isGrabbed = false;
      grabbedCube = null;
      
      // Update hint
      document.getElementById('hint').textContent = "Click to lock mouse. LMB: Blue portal, RMB: Orange portal. E: Grab/Throw cube.";
      
    } else {
      // Try to grab a cube
      
      // Raycast from camera center
      raycaster.setFromCamera(mouse.set(0, 0), camera); 
      
      // Identify all meshes belonging to dynamic objects (e.g., the cube)
      const meshesToTest = scene.children
        .filter(c => c.userData.dynamic)
        .flatMap(obj => {
            const meshes = [];
            obj.traverse(child => {
                if (child.isMesh) meshes.push(child);
            });
            return meshes;
        });

      const intersects = raycaster.intersectObjects(meshesToTest, false);

      if (intersects.length > 0) {
        const hit = intersects[0];
        const cubeCandidate = hit.object; // Fix: hit.object is the PhysicsCube instance (which is a Mesh), not its parent (which is the Scene).
        
        if (hit.distance <= grabDistance * 1.5 && cubeCandidate.userData.dynamic) { 
          grabbedCube = cubeCandidate;
          grabbedCube.isGrabbed = true;
          grabbedCube.velocity.set(0, 0, 0); // Stop movement immediately
          
          // Set initial position based on fixed grab distance
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          const targetWorldPosition = camera.position.clone().addScaledVector(forward, grabDistance);
          grabbedCube.position.copy(targetWorldPosition); 
          
          // Update hint
          document.getElementById('hint').textContent = "E: Release cube (Throw Strength: " + throwStrength.toFixed(1) + ")";
        }
      }
    }
  }
});

// Player collision and portal traversal
function resolvePlayerCollision(prev, next) {
  // Clamp to chamber bounds
  const pos = next.clone();
  pos.x = THREE.MathUtils.clamp(pos.x, chamberBounds.min.x + 0.3, chamberBounds.max.x - 0.3);
  pos.y = Math.max(pos.y, 1.0);
  pos.z = THREE.MathUtils.clamp(pos.z, chamberBounds.min.z + 0.3, chamberBounds.max.z - 0.3);

  // Portal crossing
  const portals = [blue, orange];
  for (const p of portals) {
    if (!p.isPlaced || !p.linked?.isPlaced) continue;

    const portalPos = p.getWorldPosition(new THREE.Vector3());
    const portalNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(p.getWorldQuaternion(new THREE.Quaternion())).normalize();

    const distToPortal = pos.distanceTo(portalPos);
    const triggerDistance = p.radius * 1.5;

    if (distToPortal < triggerDistance) {
      const moveDir = new THREE.Vector3().subVectors(pos, prev);
      if (moveDir.lengthSq() < 0.001) continue;
      moveDir.normalize();

      const dotProduct = moveDir.dot(portalNormal);

      // Determine portal type
      const isHorizontal = Math.abs(portalNormal.y) > 0.7;
      const isFloor = isHorizontal && portalNormal.y > 0; // normal points up
      const isCeiling = isHorizontal && portalNormal.y < 0; // normal points down

      let shouldTrigger = false;

      if (isFloor) {
        // Floor portal: trigger if moving towards OR falling down
        shouldTrigger = dotProduct < -0.3 || fps.velocity.y < -1.0;
      } else if (isCeiling) {
        // Ceiling portal: trigger if moving towards OR jumping up
        shouldTrigger = dotProduct < -0.3 || fps.velocity.y > 1.0;
      } else {
        // Wall portal: only trigger if moving towards
        shouldTrigger = dotProduct < -0.3;
      }

      if (shouldTrigger) {
        const transformed = p.transformThrough({
          position: pos,
          quaternion: fps.object.quaternion.clone(),
          velocity: fps.velocity.clone()
        });
        
        // --- CUBE TRAVERSAL WHEN HELD ---
        if (grabbedCube) {
            // Transform the held cube using the same portal transformation
            const { position: cubePosNew, quaternion: cubeQuatNew } = p.transformThrough({
                position: grabbedCube.position,
                quaternion: grabbedCube.quaternion.clone(),
                velocity: new THREE.Vector3(0, 0, 0)
            });

            grabbedCube.position.copy(cubePosNew);
            // We rely on the animate loop to reset rotation and reposition relative to the camera
        }

        fps.object.position.copy(transformed.position);
        fps.object.quaternion.copy(transformed.quaternion);
        fps.velocity.copy(transformed.velocity);

        // Check if exit portal is horizontal (floor/ceiling)
        const linkedNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(p.linked.getWorldQuaternion(new THREE.Quaternion())).normalize();
        const exitIsHorizontal = Math.abs(linkedNormal.y) > 0.7;

        if (exitIsHorizontal) {
          // Start Y-axis correction over 0.5 seconds
          orientationCorrection = {
            startQuat: fps.object.quaternion.clone(),
            startTime: performance.now(),
            duration: 500
          };
        }

        return fps.object.position.clone();
      }
    }
  }
  return pos;
}

// Resize
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", onResize);

// Debug UI Controls - DEFAULT: All disabled
const debugSteps = {
  stepA: false,
  stepB: false,
  step0: true,      // Main scene - default ON
  step1a: true,     // Blue portal mask - default ON
  step1b: true,     // Blue portal view - default ON
  step2: true,      // Orange portal - default ON
  step3: true       // Portal borders - default ON
};

const debugUI = document.getElementById('debug-ui');

// Toggle debug UI with "/" key
window.addEventListener('keydown', (e) => {
  if (e.key === '/') {
    e.preventDefault();
    if (debugUI.style.display === 'none') {
      debugUI.style.display = 'block';
    } else {
      debugUI.style.display = 'none';
    }
  }
});

// Prevent pointer lock when interacting with debug UI
debugUI.addEventListener('mousedown', (e) => {
  e.stopPropagation();
});
debugUI.addEventListener('click', (e) => {
  e.stopPropagation();
});

document.getElementById('stepA').addEventListener('change', (e) => {
  debugSteps.stepA = e.target.checked;
});
document.getElementById('stepB').addEventListener('change', (e) => {
  debugSteps.stepB = e.target.checked;
});
document.getElementById('step0').addEventListener('change', (e) => {
  debugSteps.step0 = e.target.checked;
});
document.getElementById('step1a').addEventListener('change', (e) => {
  debugSteps.step1a = e.target.checked;
});
document.getElementById('step1b').addEventListener('change', (e) => {
  debugSteps.step1b = e.target.checked;
});
document.getElementById('step2').addEventListener('change', (e) => {
  debugSteps.step2 = e.target.checked;
});
document.getElementById('step3').addEventListener('change', (e) => {
  debugSteps.step3 = e.target.checked;
});
document.getElementById('toggleDebug').addEventListener('click', () => {
  debugUI.classList.toggle('hidden');
  document.getElementById('toggleDebug').textContent = debugUI.classList.contains('hidden') ? 'Show Debug UI' : 'Hide Debug UI';
});

// Press ESC to unlock pointer and show debug UI
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (fps.enabled) {
      fps.controls.unlock();
    }
    if (debugUI.classList.contains('hidden')) {
      debugUI.classList.remove('hidden');
      document.getElementById('toggleDebug').textContent = 'Hide Debug UI';
    }
  }
});

// Render loop
let lastT = performance.now();
function animate(t) {
  const dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;

  // Apply orientation correction (from horizontal portals)
  if (orientationCorrection) {
    const elapsed = performance.now() - orientationCorrection.startTime;
    const progress = Math.min(elapsed / orientationCorrection.duration, 1.0);

    // Ease-out cubic
    const easedT = 1 - Math.pow(1 - progress, 3);

    // Get current forward direction
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientationCorrection.startQuat);
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
      fps.object.quaternion.slerpQuaternions(orientationCorrection.startQuat, targetQuat, easedT);
      orientationCorrection.startQuat.copy(fps.object.quaternion);
    }

    if (progress >= 1.0) {
      orientationCorrection = null;
    }
  }

  fps.update(dt, resolvePlayerCollision);

  // Handle grabbed cube position update: Lerp towards target position
  if (grabbedCube) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const targetWorldPosition = camera.position.clone().addScaledVector(forward, grabDistance);
    
    // Smoothly move the cube to the target position
    grabbedCube.position.lerp(targetWorldPosition, 0.5); 
    
    // Keep cube upright
    grabbedCube.rotation.set(0, 0, 0); 
  }

  cube.update(dt, chamberBounds, [blue, orange]);

  const frameNum = Math.floor(t / 16);

  // Clear screen to gray background
  renderer.setRenderTarget(null);
  renderer.autoClear = true;
  renderer.setClearColor(0x444444); // Gray background
  renderer.clear(true, true, true);

  // ============================================================================
  // STEP A+B: Stencil test - quad writes stencil, sphere tests stencil
  // ============================================================================
  if (debugSteps.stepA || debugSteps.stepB) {
    // Create test objects (only once)
    if (!window.testQuad) {
      // Green quad - writes stencil=1
      const quadGeo = new THREE.PlaneGeometry(2, 2);
      const quadMat = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        side: THREE.DoubleSide,
        depthWrite: false,
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilRef: 1,
        stencilZPass: THREE.ReplaceStencilOp
      });
      window.testQuad = new THREE.Mesh(quadGeo, quadMat);
      window.testQuad.position.set(0, 1.6, 1);  // Center
      scene.add(window.testQuad);

      // Red sphere - only renders where stencil=1
      const sphereGeo = new THREE.SphereGeometry(0.8, 32, 32);
      const sphereMat = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        stencilWrite: true,
        stencilFunc: THREE.EqualStencilFunc,
        stencilRef: 1
      });
      window.testSphere = new THREE.Mesh(sphereGeo, sphereMat);
      window.testSphere.position.set(0, 1.6, 1);  // Same position as quad
      scene.add(window.testSphere);
    }

    // Clear screen and stencil
    scene.background.set(0x000000);
    renderer.autoClear = true;
    renderer.clear(true, true, true);  // Clear color, depth, and stencil

    blue.visible = false;
    orange.visible = false;

    // STEP A: Render quad (writes stencil=1)
    if (debugSteps.stepA) {
      window.testQuad.visible = true;
      window.testSphere.visible = false;
      renderer.render(scene, camera);
    }

    // STEP B: Render sphere (only where stencil=1)
    if (debugSteps.stepB) {
      window.testQuad.visible = debugSteps.stepA;  // Keep quad visible if A is checked
      window.testSphere.visible = true;
      renderer.autoClear = false;  // Don't clear, render on top
      renderer.render(scene, camera);
    }

    // IMPORTANT: Return early
    requestAnimationFrame(animate);
    return;
  }

  // ============================================================================
  // STEP 0-3: Portal rendering (disabled for now)
  // ============================================================================
  renderer.setRenderTarget(null);

  if (debugSteps.step0) {
    // Step 0a: Render main scene
    scene.background.set(0xffffff);
    renderer.autoClear = true;
    renderer.clear(true, true, true);

    blue.visible = false;
    orange.visible = false;

    renderer.render(scene, camera);

  } else {
    scene.background.set(0xff0000);
    renderer.clear(true, true, true);
  }

  // ============================================================================
  // STEP 1a: Draw blue portal mask to stencil buffer
  // ============================================================================
  if (debugSteps.step1a) {

    // Draw blue portal mask (writes stencil=1, respects depth from Step 0)
    blue.syncMaskTransform(blueMask);
    blueMask.material.color.set(0x2a7fff);  // Blue
    blueMask.material.side = THREE.DoubleSide;
    blueMask.material.depthWrite = false;
    blueMask.material.depthTest = true;  // Respect depth from main scene
    blueMask.material.stencilWrite = true;
    blueMask.material.stencilFunc = THREE.AlwaysStencilFunc;
    blueMask.material.stencilRef = 1;
    blueMask.material.stencilZPass = THREE.ReplaceStencilOp;
    blueMask.material.needsUpdate = true;

    blueMask.visible = true;
    orangeMask.visible = false;

    renderer.autoClear = false;
    renderer.clear(false, false, true);  // Clear only stencil
    renderer.render(maskScene, camera);

    blueMask.visible = false;
  }

  // ============================================================================
  // STEP 1b: Render portal view where stencil=1
  // ============================================================================
  if (debugSteps.step1b) {

    // Calculate virtual camera (looking through blue portal from orange portal)
    blue.updateVirtualCamera(camera, fps.object);

    // DON'T clear depth - keep main scene depth for correct occlusion
    renderer.autoClear = false;
    // renderer.clear(false, true, false);  // Don't clear depth!

    // Hide portals to avoid recursive rendering
    blue.visible = true;
    orange.visible = true;

    // Temporarily disable scene background (background doesn't respect stencil)
    const originalBackground = scene.background;
    scene.background = null;

    // Apply stencil test to all scene objects
    const originalMaterials = new Map();
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        // Handle both single material and material arrays
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        const originals = [];

        materials.forEach(mat => {
          originals.push({
            stencilWrite: mat.stencilWrite,
            stencilFunc: mat.stencilFunc,
            stencilRef: mat.stencilRef
          });
          mat.stencilWrite = true;
          mat.stencilFunc = THREE.EqualStencilFunc;
          mat.stencilRef = 1;
          mat.needsUpdate = true;
        });

        originalMaterials.set(obj, originals);
      }
    });

    renderer.render(scene, blue.virtualCam);


    // Restore scene background
    scene.background = originalBackground;

    // Restore original materials
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material && originalMaterials.has(obj)) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        const originals = originalMaterials.get(obj);

        materials.forEach((mat, i) => {
          mat.stencilWrite = originals[i].stencilWrite;
          mat.stencilFunc = originals[i].stencilFunc;
          mat.stencilRef = originals[i].stencilRef;
          mat.needsUpdate = true;
        });
      }
    });
  }

  // ============================================================================
  // STEP 2: Render ORANGE portal view (same technique as Step 1)
  // ============================================================================
  if (debugSteps.step2) {

    // a. Draw orange portal mask to stencil (writes stencil=2, respects depth)
    orange.syncMaskTransform(orangeMask);
    orangeMask.material.color.set(0xff7a00);  // Orange
    orangeMask.material.side = THREE.DoubleSide;
    orangeMask.material.depthWrite = false;
    orangeMask.material.depthTest = true;  // Respect depth from main scene
    orangeMask.material.stencilWrite = true;
    orangeMask.material.stencilFunc = THREE.AlwaysStencilFunc;
    orangeMask.material.stencilRef = 2;  // Use stencil=2 for orange portal
    orangeMask.material.stencilZPass = THREE.ReplaceStencilOp;
    orangeMask.material.needsUpdate = true;

    orangeMask.visible = true;
    blueMask.visible = false;

    renderer.autoClear = false;
    // Don't clear stencil - we want to keep blue portal's stencil=1
    // Just render orange mask with stencil=2
    renderer.render(maskScene, camera);


    // b. Calculate virtual camera (looking through orange portal from blue portal)
    orange.updateVirtualCamera(camera, fps.object);

    // c. Render scene where stencil=2
    blue.visible = true;
    orange.visible = true;

    // Temporarily disable scene background
    const originalBackground = scene.background;
    scene.background = null;

    // Apply stencil test for stencil=2
    const originalMaterials = new Map();
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        const originals = [];

        materials.forEach(mat => {
          originals.push({
            stencilWrite: mat.stencilWrite,
            stencilFunc: mat.stencilFunc,
            stencilRef: mat.stencilRef
          });
          mat.stencilWrite = true;
          mat.stencilFunc = THREE.EqualStencilFunc;
          mat.stencilRef = 2;  // Test for stencil=2
          mat.needsUpdate = true;
        });

        originalMaterials.set(obj, originals);
      }
    });

    renderer.render(scene, orange.virtualCam);


    // Restore scene background
    scene.background = originalBackground;

    // Restore original materials
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material && originalMaterials.has(obj)) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        const originals = originalMaterials.get(obj);

        materials.forEach((mat, i) => {
          mat.stencilWrite = originals[i].stencilWrite;
          mat.stencilFunc = originals[i].stencilFunc;
          mat.stencilRef = originals[i].stencilRef;
          mat.needsUpdate = true;
        });
      }
    });

    orangeMask.visible = false;
  }

  // ============================================================================
  // STEP 3: Render Portal Borders on top
  // ============================================================================
  if (debugSteps.step3) {

    // Create a temporary scene with only portals
    if (!window.portalBorderScene) {
      window.portalBorderScene = new THREE.Scene();
    }

    // Temporarily add portals to border scene
    const blueParent = blue.parent;
    const orangeParent = orange.parent;

    blue.visible = true;
    orange.visible = true;

    window.portalBorderScene.add(blue);
    window.portalBorderScene.add(orange);

    // Disable autoClear so we render on top of existing frame
    renderer.autoClear = false;

    // Portal borders respect depth test (hidden when behind walls)
    renderer.render(window.portalBorderScene, camera);

    // Return portals to original parent
    if (blueParent) blueParent.add(blue);
    if (orangeParent) orangeParent.add(orange);

    renderer.autoClear = true;

  }

  // Visualize stencil buffer if requested
  if (debugSteps.visualizeStencil) {
    // Draw a fullscreen quad where stencil == 1 (shows stencil mask in red)
    renderer.state.buffers.stencil.setTest(true);
    renderer.state.buffers.stencil.setFunc(THREE.EqualStencilFunc, 1, 0xff);

    // Create a simple fullscreen red overlay
    const testMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false
    });
    const testGeo = new THREE.PlaneGeometry(50, 50);
    const testMesh = new THREE.Mesh(testGeo, testMat);
    testMesh.position.copy(camera.position);
    testMesh.position.z -= 1; // In front of camera
    testMesh.lookAt(camera.position);

    const testScene = new THREE.Scene();
    testScene.add(testMesh);

    renderer.autoClear = false;
    renderer.render(testScene, camera);
    renderer.autoClear = true;
    renderer.state.buffers.stencil.setTest(false);

  }

  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Optional: brief "whoosh" placement feedback via border emissive pulse
function pulseBorder(portal) {
  const mat = portal.children[0].material;
  let time = 0;
  const id = setInterval(() => {
    time += 0.05;
    mat.emissiveIntensity = 2 + Math.max(0, 1.5 * Math.exp(-3 * time));
    if (time > 1.2) { mat.emissiveIntensity = 2; clearInterval(id); }
  }, 16);
}
renderer.domElement.addEventListener("mousedown", (e) => {
  if (e.button === 0 && blue.isPlaced) pulseBorder(blue);
  if (e.button === 2 && orange.isPlaced) pulseBorder(orange);
});

// Remove old aiming overlay
raycaster.setFromCamera = raycaster.setFromCamera; // no-op placeholder

/**
 * Notes:
 * - This prototype uses RTT + oblique clipping for the portal window. For a stencil-based pipeline:
 *   1) Render portal ellipse to stencil (replace to 1, color write off).
 *   2) Render scene from virtualCam with stencil test equal 1.
 *   3) Repeat for second portal.
 *   This can be integrated by assigning stencil configs per material in the second pass.
 */