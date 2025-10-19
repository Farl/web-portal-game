import * as THREE from "three";
import { getDefaultLevel } from "./defaultLevels.js";

/**
 * LevelManager - Handles level persistence and slot management
 * Supports 3 save slots with localStorage, each can be reset to default
 */
export class LevelManager {
  constructor() {
    this.currentSlot = this.loadCurrentSlot();
    this.STORAGE_PREFIX = "level_slot_";
    this.CURRENT_SLOT_KEY = "current_level_slot";
  }

  /**
   * Get the current active slot (1, 2, or 3)
   */
  getCurrentSlot() {
    return this.currentSlot;
  }

  /**
   * Set the current active slot
   */
  setCurrentSlot(slot) {
    if (slot < 1 || slot > 3) {
      console.error("[LevelManager] Invalid slot:", slot);
      return;
    }
    this.currentSlot = slot;
    localStorage.setItem(this.CURRENT_SLOT_KEY, slot.toString());
  }

  /**
   * Load the current slot number from localStorage
   */
  loadCurrentSlot() {
    const stored = localStorage.getItem(this.CURRENT_SLOT_KEY);
    return stored ? parseInt(stored, 10) : 1; // Default to slot 1
  }

  /**
   * Serialize the current level state to JSON
   */
  serializeLevel(editMode) {
    const level = {
      version: "1.0",
      name: `Level Slot ${this.currentSlot}`,
      playerSpawn: this.serializeSpawner(editMode),
      defaultObjects: this.serializeDefaultObjects(editMode),
      editorObjects: this.serializeEditorObjects(editMode)
    };
    return level;
  }

  /**
   * Serialize the player spawner
   */
  serializeSpawner(editMode) {
    const spawner = editMode.defaultSpawner;
    if (!spawner) {
      return getDefaultLevel().playerSpawn;
    }

    return {
      position: {
        x: spawner.position.x,
        y: spawner.position.y,
        z: spawner.position.z
      },
      rotation: {
        x: spawner.rotation.x,
        y: spawner.rotation.y,
        z: spawner.rotation.z
      },
      moved: spawner.userData.editorMoved || false
    };
  }

  /**
   * Serialize default objects (cube, second floor, default door)
   */
  serializeDefaultObjects(editMode) {
    const defaultLevel = getDefaultLevel();
    const result = {
      cube: defaultLevel.defaultObjects.cube,
      spawner: this.serializeSpawner(editMode),
      secondFloor: defaultLevel.defaultObjects.secondFloor,
      defaultDoor: defaultLevel.defaultObjects.defaultDoor
    };

    // Update second floor visibility
    if (editMode.levelBuilder && editMode.levelBuilder.secondFloor) {
      result.secondFloor.visible = editMode.levelBuilder.secondFloor.visible;
    }

    // Update default door state
    const defaultDoor = editMode.levelBuilder ? editMode.levelBuilder.getGoal() : null;
    if (defaultDoor) {
      result.defaultDoor.visible = defaultDoor.visible;
      result.defaultDoor.position = {
        x: defaultDoor.position.x,
        y: defaultDoor.position.y,
        z: defaultDoor.position.z
      };
    }

    return result;
  }

  /**
   * Serialize editor-placed objects
   */
  serializeEditorObjects(editMode) {
    const objects = editMode.getPlacedObjects();
    const serialized = [];

    for (const obj of objects) {
      // Skip the default door (it's handled in defaultObjects)
      if (obj === editMode.levelBuilder?.getGoal()) {
        continue;
      }

      const data = {
        type: this.getObjectType(obj),
        position: {
          x: obj.position.x,
          y: obj.position.y,
          z: obj.position.z
        },
        rotation: {
          x: obj.rotation.x,
          y: obj.rotation.y,
          z: obj.rotation.z
        },
        scale: {
          x: obj.scale.x,
          y: obj.scale.y,
          z: obj.scale.z
        },
        userData: {
          portalable: obj.userData.portalable || false,
          dynamic: obj.userData.dynamic || false,
          door: obj.userData.door || false,
          isExitDoor: obj.userData.isExitDoor || false,
          goal: obj.userData.goal || false,
          spawner: obj.userData.spawner || false,
          glass: obj.userData.glass || false
        }
      };

      // For cubes, store initial position
      if (obj.userData.dynamic && obj.userData.initialPosition) {
        data.initialPosition = {
          x: obj.userData.initialPosition.x,
          y: obj.userData.initialPosition.y,
          z: obj.userData.initialPosition.z
        };
      }

      serialized.push(data);
    }

    return serialized;
  }

  /**
   * Determine object type from userData and geometry
   */
  getObjectType(obj) {
    if (obj.userData.spawner) return "spawner";
    if (obj.userData.dynamic) return "cube";
    if (obj.userData.door) return "door";
    if (obj.userData.glass) return "glass-wall";

    // Distinguish between wall and platform based on geometry
    const geometry = obj.geometry;
    if (geometry && geometry.parameters) {
      const { width, height, depth } = geometry.parameters;
      // Platform: height is smallest dimension
      if (height < width && height < depth) {
        return "platform";
      }
      // Wall: depth is smallest dimension
      if (depth < width && depth < height) {
        return "wall";
      }
    }

    return "wall"; // Default fallback
  }

  /**
   * Save current level to the current slot
   */
  saveLevel(editMode) {
    const level = this.serializeLevel(editMode);
    const key = this.STORAGE_PREFIX + this.currentSlot;
    try {
      localStorage.setItem(key, JSON.stringify(level));
      console.log(`[LevelManager] Saved level to slot ${this.currentSlot}`);
      return true;
    } catch (e) {
      console.error("[LevelManager] Failed to save level:", e);
      return false;
    }
  }

  /**
   * Load level from the current slot
   */
  loadLevel() {
    const key = this.STORAGE_PREFIX + this.currentSlot;
    const stored = localStorage.getItem(key);

    if (!stored) {
      console.log(`[LevelManager] No saved level in slot ${this.currentSlot}, using default`);
      return getDefaultLevel();
    }

    try {
      const level = JSON.parse(stored);
      // Validate version
      if (!level.version || level.version !== "1.0") {
        console.warn("[LevelManager] Invalid level version, using default");
        return getDefaultLevel();
      }
      console.log(`[LevelManager] Loaded level from slot ${this.currentSlot}`);
      return level;
    } catch (e) {
      console.error("[LevelManager] Failed to parse level:", e);
      return getDefaultLevel();
    }
  }

  /**
   * Reset current slot to default level
   */
  resetToDefault() {
    const key = this.STORAGE_PREFIX + this.currentSlot;
    localStorage.removeItem(key);
    console.log(`[LevelManager] Reset slot ${this.currentSlot} to default`);
    return getDefaultLevel();
  }

  /**
   * Apply loaded level data to edit mode
   */
  applyLevel(editMode, levelData) {
    // Clear existing editor objects
    editMode.clearAllObjects();

    // Apply player spawner
    this.applySpawner(editMode, levelData.playerSpawn);

    // Apply default objects
    this.applyDefaultObjects(editMode, levelData.defaultObjects);

    // Apply editor objects
    this.applyEditorObjects(editMode, levelData.editorObjects);

    console.log("[LevelManager] Applied level data");
  }

  /**
   * Apply spawner data
   */
  applySpawner(editMode, spawnerData) {
    if (!editMode.defaultSpawner || !spawnerData) return;

    editMode.defaultSpawner.position.set(
      spawnerData.position.x,
      spawnerData.position.y,
      spawnerData.position.z
    );
    editMode.defaultSpawner.rotation.set(
      spawnerData.rotation.x,
      spawnerData.rotation.y,
      spawnerData.rotation.z
    );
    editMode.defaultSpawner.userData.editorMoved = spawnerData.moved || false;
  }

  /**
   * Apply default objects data
   */
  applyDefaultObjects(editMode, defaultObjectsData) {
    // Apply default cube position
    if (editMode.defaultCube && defaultObjectsData.cube) {
      editMode.defaultCube.position.set(
        defaultObjectsData.cube.position.x,
        defaultObjectsData.cube.position.y,
        defaultObjectsData.cube.position.z
      );
    }

    // Apply second floor visibility
    if (editMode.levelBuilder && editMode.levelBuilder.secondFloor && defaultObjectsData.secondFloor) {
      editMode.levelBuilder.secondFloor.visible = defaultObjectsData.secondFloor.visible;
    }

    // Apply default door state
    const defaultDoor = editMode.levelBuilder ? editMode.levelBuilder.getGoal() : null;
    if (defaultDoor && defaultObjectsData.defaultDoor) {
      defaultDoor.visible = defaultObjectsData.defaultDoor.visible;
      defaultDoor.position.set(
        defaultObjectsData.defaultDoor.position.x,
        defaultObjectsData.defaultDoor.position.y,
        defaultObjectsData.defaultDoor.position.z
      );

      // Ensure all children (door frame parts) are visible
      defaultDoor.traverse((child) => {
        child.visible = defaultObjectsData.defaultDoor.visible;
      });

      // Reset door state
      defaultDoor.scale.set(1, 1, 1);
      defaultDoor.userData.isOpen = false;

      // Re-add to editor objects if visible
      if (defaultDoor.visible && !editMode.objects.includes(defaultDoor)) {
        editMode.objects.push(defaultDoor);
      }
    }
  }

  /**
   * Apply editor-placed objects
   */
  applyEditorObjects(editMode, editorObjectsData) {
    for (const data of editorObjectsData) {
      const position = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
      let obj = null;

      // Create object based on type
      switch (data.type) {
        case "wall":
          obj = editMode.createWall(position, data.userData.portalable);
          break;
        case "glass-wall":
          obj = editMode.createGlassWall(position);
          break;
        case "platform":
          obj = editMode.createPlatform(position, data.userData.portalable);
          break;
        case "cube":
          obj = editMode.createCube(position);
          if (data.initialPosition) {
            obj.userData.initialPosition = new THREE.Vector3(
              data.initialPosition.x,
              data.initialPosition.y,
              data.initialPosition.z
            );
          }
          break;
        case "door":
          obj = editMode.createDoor(position, data.userData.isExitDoor);
          break;
        case "spawner":
          obj = editMode.createSpawner(position);
          break;
      }

      if (obj) {
        // Apply transform
        obj.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
        obj.scale.set(data.scale.x, data.scale.y, data.scale.z);

        // Apply userData
        Object.assign(obj.userData, data.userData);

        // Add to scene and track
        if (data.type !== "spawner") {
          editMode.scene.add(obj);
          editMode.objects.push(obj);
        }
      }
    }
  }
}
