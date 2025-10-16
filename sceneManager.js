import * as THREE from "three";
import { CONFIG } from "./config.js";

/**
 * SceneManager - Handles Three.js renderer, scene, camera, and lighting setup
 */
export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderScale = CONFIG.renderScale.default;

    // Initialize renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: CONFIG.renderer.antialias,
      alpha: CONFIG.renderer.alpha,
      stencil: CONFIG.renderer.stencil,
    });

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio) * this.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = CONFIG.renderer.shadowsEnabled;

    // Initialize scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CONFIG.renderer.backgroundColor);

    // Initialize camera
    const { fov, near, far, startPosition, rotationOrder } = CONFIG.camera;
    this.camera = new THREE.PerspectiveCamera(
      fov,
      window.innerWidth / window.innerHeight,
      near,
      far
    );
    this.camera.position.set(startPosition.x, startPosition.y, startPosition.z);
    this.camera.rotation.order = rotationOrder;

    // Enable all layers for the camera (by default only Layer 0 is enabled)
    this.camera.layers.enableAll();

    this.scene.add(this.camera);

    // Setup lighting
    this.setupLighting();

    // Setup resize handler
    window.addEventListener("resize", () => this.onResize());

    // Load saved render scale
    this.loadRenderScale();
  }

  setupLighting() {
    const { hemisphere, directional } = CONFIG.lighting;

    // Hemisphere light
    const hemi = new THREE.HemisphereLight(
      hemisphere.skyColor,
      hemisphere.groundColor,
      hemisphere.intensity
    );
    hemi.layers.enableAll(); // Enable lights on all layers
    this.scene.add(hemi);

    // Directional light
    const dir = new THREE.DirectionalLight(
      directional.color,
      directional.intensity
    );
    dir.position.set(
      directional.position.x,
      directional.position.y,
      directional.position.z
    );
    dir.castShadow = true;
    dir.shadow.camera.near = directional.shadowCameraNear;
    dir.shadow.camera.far = directional.shadowCameraFar;
    dir.layers.enableAll(); // Enable lights on all layers
    this.scene.add(dir);
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setRenderScale(scale) {
    this.renderScale = scale;
    localStorage.setItem(CONFIG.renderScale.storageKey, String(scale));
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio) * scale
    );
    this.onResize();
  }

  loadRenderScale() {
    const saved = localStorage.getItem(CONFIG.renderScale.storageKey);
    if (saved) {
      this.setRenderScale(Number(saved));
    }
  }

  getRenderScale() {
    return this.renderScale;
  }

  clearScreen(color = CONFIG.renderer.clearColor) {
    this.renderer.setRenderTarget(null);
    this.renderer.autoClear = true;
    this.renderer.setClearColor(color);
    this.renderer.clear(true, true, true);
  }

  render(scene, camera) {
    this.renderer.render(scene || this.scene, camera || this.camera);
  }
}
