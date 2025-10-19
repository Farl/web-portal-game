import * as THREE from "three";
import { CONFIG } from "./config.js";

/**
 * PortalPlacement - Handles portal placement logic and validation
 */
export class PortalPlacement {
  constructor(chamber, camera) {
    this.chamber = chamber;
    this.camera = camera;
    this.editorObjects = []; // Additional portalable objects from editor
  }

  /**
   * Add editor-placed objects for raycast detection
   * Includes ALL objects (both portalable and non-portalable)
   * Non-portalable objects will block raycasts but reject portal placement
   */
  setEditorObjects(objects) {
    // Include all editor objects for raycast, not just portalable ones
    // Filter out dynamic objects (cubes) and spawners (not solid surfaces)
    this.editorObjects = objects.filter(obj =>
      !obj.userData.dynamic &&
      !obj.userData.spawner &&
      !obj.userData.goal
    );
  }

  /**
   * Place portal at raycast intersection
   */
  placePortal(raycaster, portal) {
    // Combine chamber objects and editor-placed objects
    const allObjects = [...this.chamber.children, ...this.editorObjects];

    // Raycast against ALL objects (not just portalable)
    // This ensures non-portalable surfaces block the raycast
    const intersects = raycaster.intersectObjects(allObjects, false);

    if (intersects.length === 0) return false;

    const hit = intersects[0];

    // Check if the hit surface is portalable
    // If not, reject the placement (but the surface still blocked the raycast)
    if (!hit.object.userData.portalable) {
      return false;
    }

    // Check size margin: avoid placing if near wall edges
    const margin = CONFIG.portal.placementMargin;
    const localPoint = hit.point.clone().applyMatrix4(
      new THREE.Matrix4().copy(hit.object.matrixWorld).invert()
    );

    const geom = hit.object.geometry;
    if (!geom.boundingBox) geom.computeBoundingBox();

    const halfSize = new THREE.Vector3()
      .subVectors(geom.boundingBox.max, geom.boundingBox.min)
      .multiplyScalar(0.5);

    const axes = ["x", "y", "z"];
    const thinAxis = axes.reduce((minA, a) => halfSize[a] < halfSize[minA] ? a : minA, "x");
    const thickAxes = axes.filter(a => a !== thinAxis);

    if (
      Math.abs(localPoint[thickAxes[0]]) > halfSize[thickAxes[0]] - margin ||
      Math.abs(localPoint[thickAxes[1]]) > halfSize[thickAxes[1]] - margin
    ) {
      return false;
    }

    portal.placeAt(hit);
    return true;
  }

  /**
   * Auto-place initial portals
   */
  placeInitialPortals(bluePortal, orangePortal) {
    const halfRoomScale = CONFIG.room.scale / 2.0;
    const halfWallThickness = CONFIG.room.wallThickness / 2.0;

    const backWall = this.chamber.children.find(
      m => m.userData.portalable && Math.abs(m.position.z + halfRoomScale + halfWallThickness) < 1e-3
    );

    const frontWall = this.chamber.children.find(
      m => m.userData.portalable && Math.abs(m.position.z - halfRoomScale - halfWallThickness) < 1e-3
    );

    if (backWall) {
      bluePortal.placeAt({
        object: backWall,
        point: backWall.localToWorld(new THREE.Vector3(0, -halfRoomScale + 1, halfWallThickness)),
        face: { normal: new THREE.Vector3(0, 0, 1) }
      });
    }

    if (frontWall) {
      orangePortal.placeAt({
        object: frontWall,
        point: frontWall.localToWorld(new THREE.Vector3(0, -halfRoomScale + 1, -halfWallThickness)),
        face: { normal: new THREE.Vector3(0, 0, -1) }
      });
    }
  }

  /**
   * Pulse portal border for visual feedback
   */
  pulseBorder(portal) {
    const mat = portal.children[0].material;
    let time = 0;
    const id = setInterval(() => {
      time += 0.05;
      mat.emissiveIntensity = CONFIG.portal.emissiveIntensity + Math.max(0, 1.5 * Math.exp(-3 * time));
      if (time > 1.2) {
        mat.emissiveIntensity = CONFIG.portal.emissiveIntensity;
        clearInterval(id);
      }
    }, CONFIG.portal.pulseInterval);
  }
}
