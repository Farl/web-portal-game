import * as THREE from "three";
import { CONFIG } from "./config.js";

/**
 * PortalRenderer - Handles the stencil-based portal rendering pipeline
 * Encapsulates the complex multi-step rendering process
 */
export class PortalRenderer {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    // Create mask scene (contains only portal masks)
    this.maskScene = new THREE.Scene();

    // Portal border scene (for rendering borders on top)
    this.portalBorderScene = new THREE.Scene();

    // Stencil test visualization objects
    this.testQuad = null;
    this.testSphere = null;
  }

  /**
   * Syncs mask transform with portal
   */
  syncMaskTransform(portal, mask) {
    portal.syncMaskTransform(mask);
  }

  /**
   * Apply stencil test to all materials in scene
   */
  applyStencilTest(scene, stencilRef, originalMaterials) {
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
          mat.stencilRef = stencilRef;
          mat.needsUpdate = true;
        });

        originalMaterials.set(obj, originals);
      }
    });
  }

  /**
   * Restore original material properties
   */
  restoreMaterials(scene, originalMaterials) {
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

  /**
   * Configure mask material for portal
   */
  configureMask(mask, color, stencilRef) {
    mask.material.color.set(color);
    mask.material.side = THREE.DoubleSide;
    mask.material.depthWrite = false;
    mask.material.depthTest = true;
    mask.material.stencilWrite = true;
    mask.material.stencilFunc = THREE.AlwaysStencilFunc;
    mask.material.stencilRef = stencilRef;
    mask.material.stencilZPass = THREE.ReplaceStencilOp;
    mask.material.needsUpdate = true;
  }

  /**
   * Render portal mask to stencil buffer
   */
  renderPortalMask(mask, color, stencilRef) {
    this.configureMask(mask, color, stencilRef);
    mask.visible = true;
    this.renderer.autoClear = false;
    this.renderer.render(this.maskScene, this.camera);
    mask.visible = false;
  }

  /**
   * Render portal view through stencil
   */
  renderPortalView(portal, stencilRef, portalsVisible = true) {
    // Calculate virtual camera
    portal.updateVirtualCamera(this.camera, null);

    // Hide/show portals
    if (portalsVisible) {
      // Show portals in the view
    }

    this.renderer.autoClear = false;

    // Temporarily disable scene background (background doesn't respect stencil)
    const originalBackground = this.scene.background;
    this.scene.background = null;

    // Apply stencil test
    const originalMaterials = new Map();
    this.applyStencilTest(this.scene, stencilRef, originalMaterials);

    // Render
    this.renderer.render(this.scene, portal.virtualCam);

    // Restore scene background
    this.scene.background = originalBackground;

    // Restore materials
    this.restoreMaterials(this.scene, originalMaterials);
  }

  /**
   * Render portal borders on top
   */
  renderPortalBorders(bluePortal, orangePortal) {
    // Save original parents
    const blueParent = bluePortal.parent;
    const orangeParent = orangePortal.parent;

    bluePortal.visible = true;
    orangePortal.visible = true;

    // Temporarily move portals to border scene
    this.portalBorderScene.add(bluePortal);
    this.portalBorderScene.add(orangePortal);

    this.renderer.autoClear = false;
    this.renderer.render(this.portalBorderScene, this.camera);

    // Remove from border scene first
    this.portalBorderScene.remove(bluePortal);
    this.portalBorderScene.remove(orangePortal);

    // Return portals to original parent
    if (blueParent) blueParent.add(bluePortal);
    if (orangeParent) orangeParent.add(orangePortal);

    this.renderer.autoClear = true;
  }

  /**
   * Complete portal rendering pipeline
   */
  renderPortals(bluePortal, orangePortal, blueMask, orangeMask, debugSteps, fpsObject) {
    // Step 0: Render main scene
    if (debugSteps.step0) {
      this.scene.background.set(CONFIG.renderer.backgroundColor);
      this.renderer.autoClear = true;
      this.renderer.clear(true, true, true);

      bluePortal.visible = false;
      orangePortal.visible = false;

      this.renderer.render(this.scene, this.camera);
    } else {
      this.scene.background.set(0xff0000);
      this.renderer.clear(true, true, true);
    }

    // Step 1a: Draw blue portal mask to stencil buffer
    if (debugSteps.step1a) {
      this.syncMaskTransform(bluePortal, blueMask);
      this.renderer.clear(false, false, true); // Clear only stencil
      this.renderPortalMask(blueMask, CONFIG.portal.blueColor, 1);
    }

    // Step 1b: Render blue portal view where stencil=1
    if (debugSteps.step1b) {
      bluePortal.visible = true;
      orangePortal.visible = true;
      this.renderPortalView(bluePortal, 1, true);
    }

    // Step 2: Render orange portal (mask + view)
    if (debugSteps.step2) {
      // 2a: Draw orange portal mask
      this.syncMaskTransform(orangePortal, orangeMask);
      this.renderPortalMask(orangeMask, CONFIG.portal.orangeColor, 2);

      // 2b: Render orange portal view where stencil=2
      bluePortal.visible = true;
      orangePortal.visible = true;
      this.renderPortalView(orangePortal, 2, true);
    }

    // Step 3: Render portal borders on top
    if (debugSteps.step3) {
      this.renderPortalBorders(bluePortal, orangePortal);
    }
  }

  /**
   * Render debug stencil test (Step A+B)
   */
  renderStencilTest(debugSteps) {
    // Create test objects if needed
    if (!this.testQuad) {
      this.createTestObjects();
    }

    // Clear screen
    this.scene.background.set(0x000000);
    this.renderer.autoClear = true;
    this.renderer.clear(true, true, true);

    // Step A: Render quad (writes stencil=1)
    if (debugSteps.stepA) {
      this.testQuad.visible = true;
      this.testSphere.visible = false;
      this.renderer.render(this.scene, this.camera);
    }

    // Step B: Render sphere (only where stencil=1)
    if (debugSteps.stepB) {
      this.testQuad.visible = debugSteps.stepA;
      this.testSphere.visible = true;
      this.renderer.autoClear = false;
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Create test objects for stencil debugging
   */
  createTestObjects() {
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
    this.testQuad = new THREE.Mesh(quadGeo, quadMat);
    this.testQuad.position.set(0, 1.6, 1);
    this.scene.add(this.testQuad);

    // Red sphere - only renders where stencil=1
    const sphereGeo = new THREE.SphereGeometry(0.8, 32, 32);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      stencilWrite: true,
      stencilFunc: THREE.EqualStencilFunc,
      stencilRef: 1
    });
    this.testSphere = new THREE.Mesh(sphereGeo, sphereMat);
    this.testSphere.position.set(0, 1.6, 1);
    this.scene.add(this.testSphere);
  }

  /**
   * Cleanup test objects
   */
  hideTestObjects() {
    if (this.testQuad) this.testQuad.visible = false;
    if (this.testSphere) this.testSphere.visible = false;
  }

  getMaskScene() {
    return this.maskScene;
  }
}
