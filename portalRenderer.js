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
   * Uses a material-level Map to avoid duplicate saves when materials are shared
   */
  applyStencilTest(scene, stencilRef, originalMaterials) {
    const materialMap = new Map(); // Track which materials we've already processed

    scene.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        const originals = [];

        materials.forEach(mat => {
          // Only save original values if we haven't processed this material yet
          if (!materialMap.has(mat)) {
            materialMap.set(mat, {
              stencilWrite: mat.stencilWrite,
              stencilFunc: mat.stencilFunc,
              stencilRef: mat.stencilRef
            });
          }

          // Save reference to the original for this object
          originals.push(materialMap.get(mat));

          // Apply stencil test settings
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
    mask.material.depthWrite = true; // Write portal surface depth so transparent objects can occlude portal views
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
    this.renderer.render(this.maskScene, this.camera);
    mask.visible = false;
  }

  /**
   * Render portal view through stencil
   */
  renderPortalView(portal, stencilRef, portalsVisible = true) {
    // Calculate virtual camera
    portal.updateVirtualCamera(this.camera, null);

    // Ensure virtual camera can see all layers (including transparent objects on Layer 1)
    portal.virtualCam.layers.enableAll();

    // Hide/show portals
    if (portalsVisible) {
      // Show portals in the view
    }

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

    // Force update world matrices to prevent position lag during camera movement
    // This ensures portal borders align perfectly with portal views
    bluePortal.updateMatrixWorld(true);
    orangePortal.updateMatrixWorld(true);

    this.renderer.render(this.portalBorderScene, this.camera);

    // Remove from border scene first
    this.portalBorderScene.remove(bluePortal);
    this.portalBorderScene.remove(orangePortal);

    // Return portals to original parent
    if (blueParent) blueParent.add(bluePortal);
    if (orangeParent) orangeParent.add(orangePortal);
  }

  /**
   * Override depth in portal area with portal surface depth
   * This ensures transparent objects can correctly occlude portal views
   */
  renderPortalDepthOverride(mask) {
    // Disable color writes, only write depth
    const gl = this.renderer.getContext();
    gl.colorMask(false, false, false, false);

    // Save original material settings
    const originalDepthFunc = mask.material.depthFunc;
    const originalDepthWrite = mask.material.depthWrite;
    const originalStencilWrite = mask.material.stencilWrite;

    mask.material.depthWrite = true;
    mask.material.depthTest = true;
    mask.material.depthFunc = THREE.AlwaysDepth; // Always write depth
    mask.material.stencilWrite = false; // Don't modify stencil
    mask.material.needsUpdate = true;

    mask.visible = true;
    this.renderer.render(this.maskScene, this.camera);
    mask.visible = false;

    // Restore material settings
    mask.material.depthFunc = originalDepthFunc;
    mask.material.depthWrite = originalDepthWrite;
    mask.material.stencilWrite = originalStencilWrite;
    mask.material.needsUpdate = true;

    // Re-enable color writes
    gl.colorMask(true, true, true, true);
  }

  /**
   * Complete portal rendering pipeline
   */
  renderPortals(bluePortal, orangePortal, blueMask, orangeMask, debugSteps, fpsObject) {
    // CRITICAL: scene.background overrides autoClear settings and forces clearing!
    // We must set it to null and use setClearColor instead
    this.scene.background = null;
    this.renderer.setClearColor(CONFIG.renderer.backgroundColor);

    // Disable autoClear to prevent automatic clearing
    // We manually control all clear operations
    this.renderer.autoClear = false;

    // Manually clear all buffers at the start
    this.renderer.clear(true, true, true);

    // Force update world matrices for all portals BEFORE any rendering
    // This ensures syncMaskTransform gets the latest transforms
    this.scene.updateMatrixWorld(true);

    // Helper function to render a portal (mask + view + depth override)
    const renderPortal = (portal, otherPortal, mask, color, stencilRef, stepMaskEnabled, stepViewEnabled) => {
      // Draw portal mask to stencil buffer
      if (stepMaskEnabled) {
        this.syncMaskTransform(portal, mask);
        this.renderPortalMask(mask, color, stencilRef);
      }

      // Render portal view where stencil=stencilRef
      if (stepViewEnabled) {
        // When rendering blue portal view, we're looking FROM orange TO blue
        // So hide orange portal (exit point), show blue portal (entry point)
        // Vice versa for orange portal view
        otherPortal.visible = false;
        portal.visible = true;
        this.renderPortalView(portal, stencilRef, true);

        // Override portal area depth with portal surface depth
        if (stepMaskEnabled) {
          this.renderPortalDepthOverride(mask);
        }
      }
    };

    // Step 0-1: Blue portal (looking FROM orange TO blue)
    renderPortal(bluePortal, orangePortal, blueMask, CONFIG.portal.blueColor, 1, debugSteps.step0, debugSteps.step1);

    // Step 2-3: Orange portal (looking FROM blue TO orange)
    renderPortal(orangePortal, bluePortal, orangeMask, CONFIG.portal.orangeColor, 2, debugSteps.step2, debugSteps.step3);

    // Step 4: Render main scene (after portals, so it can occlude them)
    if (debugSteps.step4) {
      bluePortal.visible = false;
      orangePortal.visible = false;

      // Hide Layer 1 (transparent objects) for main scene render
      this.camera.layers.disable(1);

      this.renderer.render(this.scene, this.camera);

      // Restore Layer 1 for portal views
      this.camera.layers.enable(1);
    }

    // Step 5: Render portal borders on top
    if (debugSteps.step5) {
      // Restore correct depth in portal areas before rendering borders
      // This ensures borders are occluded by scene objects (e.g., cubes in front of portals)
      const gl = this.renderer.getContext();

      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.NOTEQUAL, 0, 0xFF); // All portal areas (stencil != 0)
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.depthFunc(gl.LESS); // Only overwrite if scene object is closer
      gl.colorMask(false, false, false, false); // Only write depth, not color

      bluePortal.visible = false;
      orangePortal.visible = false;
      this.camera.layers.disable(1);
      this.renderer.render(this.scene, this.camera);
      this.camera.layers.enable(1);

      gl.colorMask(true, true, true, true);
      gl.disable(gl.STENCIL_TEST);

      // Render borders with normal depth test
      this.renderPortalBorders(bluePortal, orangePortal);
    }

    // Step 6: Render transparent objects (Layer 1) after portal borders
    if (debugSteps.step4 && debugSteps.step6) {
      // Count transparent objects on Layer 1
      let count = 0;
      const layer1 = new THREE.Layers();
      layer1.set(1);
      this.scene.traverse((obj) => {
        if (obj.isMesh && obj.layers.test(layer1)) {
          count++;
        }
      });

      if (count > 0) {
        bluePortal.visible = false;
        orangePortal.visible = false;

        // Clear stencil buffer so transparent objects aren't affected by portal masks
        this.renderer.clear(false, false, true); // Clear only stencil buffer

        // Hide Layer 0, show only Layer 1 (transparent objects)
        this.camera.layers.disable(0);

        this.renderer.render(this.scene, this.camera);

        // Restore Layer 0
        this.camera.layers.enable(0);
      }
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
    if (!this.scene.background) {
      this.scene.background = new THREE.Color(0x000000);
    } else {
      this.scene.background.set(0x000000);
    }
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
